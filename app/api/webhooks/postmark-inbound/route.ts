import { createHash } from 'node:crypto'

import { broadcastNewMessage } from '@/lib/realtime-broadcast'
import {
  clientIpFrom,
  extractBody,
  extractMailboxHash,
  extractSenderEmail,
  findHeader,
  InboundPayloadSchema,
  parseMessageIds,
  verifyInboundRequest,
  type InboundPayload,
} from '@/lib/postmark-inbound'
import { createAdminClient } from '@/lib/supabase/admin'

// node:crypto (timing-safe credential comparison) is not available on Edge.
export const runtime = 'nodejs'

const MAX_BODY_CHARS = 20_000
/** References chains grow without bound; the recent end is what threads. */
const MAX_THREAD_CANDIDATES = 25

type Admin = ReturnType<typeof createAdminClient>

/**
 * Postmark inbound webhook.
 *
 * Postmark retries any non-200 up to 10 times over ~10.5 hours, so the contract
 * here is deliberate:
 *
 * - 401 / 403  the caller is not Postmark. Retries are not our problem.
 * - 200        the payload is durably stored, or safely discarded because no
 *              amount of retrying would make it routable (unknown workspace,
 *              malformed JSON, no sender, duplicate delivery).
 * - 500        we could not store a payload we should have. Postmark should
 *              retry, and it will be deduplicated by Message-ID when it does.
 *
 * Everything after the message row is committed is best-effort and cannot turn
 * a stored payload into a retry.
 */
export async function POST(request: Request): Promise<Response> {
  const verified = verifyInboundRequest(request, clientIpFrom(request))
  if (!verified.ok) {
    log('warn', 'rejected', { reason: verified.reason, status: verified.status })
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: verified.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const raw = await request.text()
  const payload = parsePayload(raw)
  if (!payload) return accepted('malformed')

  const context = {
    postmarkMessageId: payload.MessageID,
    mailboxHash: extractMailboxHash(payload),
    from: extractSenderEmail(payload),
    subject: payload.Subject.slice(0, 120),
    originalRecipient: payload.OriginalRecipient,
  }

  if (!context.mailboxHash) {
    log('warn', 'unroutable_no_mailbox_hash', context)
    return accepted('unroutable')
  }
  if (!context.from) {
    log('warn', 'unroutable_no_sender', { ...context, rawFrom: payload.From })
    return accepted('unroutable')
  }

  const admin = createAdminClient()

  const { data: workspace, error: workspaceError } = await admin
    .from('workspaces')
    .select('id')
    .eq('inbound_token', context.mailboxHash)
    .maybeSingle()

  if (workspaceError) {
    log('error', 'workspace_lookup_failed', { ...context, error: workspaceError.message })
    return new Response(JSON.stringify({ error: 'Lookup failed' }), { status: 500 })
  }
  if (!workspace) {
    log('warn', 'unroutable_unknown_workspace', context)
    return accepted('unroutable')
  }

  const emailMessageId = inboundMessageId(payload, raw)
  const scoped = { ...context, workspaceId: workspace.id, emailMessageId }

  // Cheap idempotency check. The unique index on
  // (workspace_id, email_message_id) is the authority — see the insert below.
  const { data: duplicate } = await admin
    .from('messages')
    .select('id')
    .eq('workspace_id', workspace.id)
    .eq('email_message_id', emailMessageId)
    .maybeSingle()

  if (duplicate) {
    log('info', 'duplicate_delivery', { ...scoped, existingMessageId: duplicate.id })
    return accepted('duplicate')
  }

  const inReplyTo = parseMessageIds(findHeader(payload, 'in-reply-to'))
  const references = parseMessageIds(findHeader(payload, 'references'))

  let resolved: ResolvedConversation
  try {
    resolved = await resolveConversation(admin, workspace.id, payload, context.from, {
      inReplyTo,
      references,
    })
  } catch (err) {
    log('error', 'conversation_resolution_failed', { ...scoped, error: describe(err) })
    return new Response(JSON.stringify({ error: 'Could not resolve conversation' }), { status: 500 })
  }

  const fullBody = extractBody(payload)
  const body = fullBody.slice(0, MAX_BODY_CHARS) || '(no content)'

  const { data: message, error: insertError } = await admin
    .from('messages')
    .insert({
      workspace_id: workspace.id,
      conversation_id: resolved.conversationId,
      sender_type: 'contact',
      // The conversation's contact, not a lookup by sender address: a customer
      // may reply from a different alias and it is still their thread.
      sender_id: resolved.contactId,
      body,
      email_message_id: emailMessageId,
      email_in_reply_to: inReplyTo[0] ?? null,
    })
    .select('id, body, sender_type, sender_id, created_at')
    .single()

  if (insertError) {
    // Two concurrent deliveries of the same email raced past the check above.
    if (insertError.code === '23505') {
      log('info', 'duplicate_delivery_race', scoped)
      return accepted('duplicate')
    }
    log('error', 'message_insert_failed', {
      ...scoped,
      conversationId: resolved.conversationId,
      error: insertError.message,
      code: insertError.code,
    })
    return new Response(JSON.stringify({ error: 'Could not store message' }), { status: 500 })
  }

  log('info', 'stored', {
    ...scoped,
    conversationId: resolved.conversationId,
    messageId: message.id,
    threaded: resolved.matchedOn,
    bodyChars: body.length,
    truncatedFrom: fullBody.length > MAX_BODY_CHARS ? fullBody.length : undefined,
  })

  // Past this line the payload is durable. Nothing below may cause a retry:
  // Postmark redelivering would only be deduplicated and dropped, so a failure
  // here has to be logged and swallowed. Later work such as an AI summary hangs
  // off this same point and gets the same treatment.
  try {
    // A failed query resolves with an error rather than throwing, so the catch
    // below would not see it — it has to be inspected.
    const [touched] = await Promise.all([
      admin
        .from('conversations')
        .update({
          last_message_at: message.created_at,
          ...(resolved.needsReopen ? { status: 'open' as const } : {}),
        })
        .eq('id', resolved.conversationId)
        .eq('workspace_id', workspace.id),
      broadcastNewMessage(workspace.id, resolved.conversationId, message),
    ])
    if (touched.error) {
      log('error', 'conversation_touch_failed', {
        ...scoped,
        conversationId: resolved.conversationId,
        error: touched.error.message,
      })
    }
  } catch (err) {
    log('error', 'post_store_side_effects_failed', {
      ...scoped,
      messageId: message.id,
      error: describe(err),
    })
  }

  return accepted('stored')
}

// ---------------------------------------------------------------------------
// Conversation resolution
// ---------------------------------------------------------------------------

interface ResolvedConversation {
  conversationId: string
  contactId: string
  needsReopen: boolean
  matchedOn: 'in-reply-to' | 'references' | 'new-thread'
}

/**
 * Threading takes precedence over everything else. MailboxHash identifies the
 * tenant, but only Message-ID / In-Reply-To can identify the thread — the
 * sender address cannot, because a customer may reply from a different alias
 * than the one that opened the conversation.
 */
async function resolveConversation(
  admin: Admin,
  workspaceId: string,
  payload: InboundPayload,
  senderEmail: string,
  headers: { inReplyTo: string[]; references: string[] },
): Promise<ResolvedConversation> {
  // In-Reply-To is the direct parent, so it is never dropped. References is
  // oldest-first and unbounded, so the recent tail is the part worth querying.
  const parentIds = new Set(headers.inReplyTo)
  const candidates = Array.from(
    new Set(headers.inReplyTo.concat(headers.references.slice(-MAX_THREAD_CANDIDATES))),
  )

  if (candidates.length > 0) {
    const { data, error } = await admin
      .from('messages')
      .select('email_message_id, conversation_id, conversations(contact_id, status)')
      .eq('workspace_id', workspaceId)
      .in('email_message_id', candidates)
      .order('created_at', { ascending: false })

    if (error) throw error

    const rows = data ?? []
    // Prefer the direct parent; a References-only hit is the fallback for
    // clients that send a chain without In-Reply-To.
    const parent =
      rows.find((r) => r.email_message_id && parentIds.has(r.email_message_id)) ?? rows[0]

    if (parent?.conversations) {
      return {
        conversationId: parent.conversation_id,
        contactId: parent.conversations.contact_id,
        // A reply to a resolved or snoozed thread has to bring it back.
        needsReopen: parent.conversations.status !== 'open',
        matchedOn:
          parent.email_message_id && parentIds.has(parent.email_message_id)
            ? 'in-reply-to'
            : 'references',
      }
    }
  }

  const contactId = await findOrCreateContact(admin, workspaceId, senderEmail)

  const { data: conversation, error } = await admin
    .from('conversations')
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      channel: 'email',
      subject: payload.Subject.trim() || null,
    })
    .select('id')
    .single()

  if (error) throw error

  return {
    conversationId: conversation.id,
    contactId,
    needsReopen: false,
    matchedOn: 'new-thread',
  }
}

async function findOrCreateContact(
  admin: Admin,
  workspaceId: string,
  email: string,
): Promise<string> {
  const { data: existing, error: lookupError } = await admin
    .from('contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .ilike('email', email)
    .maybeSingle()

  if (lookupError) throw lookupError
  if (existing) return existing.id

  const { data: created, error: insertError } = await admin
    .from('contacts')
    .insert({ workspace_id: workspaceId, email })
    .select('id')
    .single()

  if (!insertError) return created.id

  // Lost a race against a concurrent delivery from the same address.
  if (insertError.code === '23505') {
    const { data: raced } = await admin
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .ilike('email', email)
      .maybeSingle()
    if (raced) return raced.id
  }
  throw insertError
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePayload(raw: string): InboundPayload | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    log('warn', 'malformed_json', { bytes: raw.length, head: raw.slice(0, 300) })
    return null
  }

  const parsed = InboundPayloadSchema.safeParse(json)
  if (!parsed.success) {
    log('warn', 'malformed_payload', {
      bytes: raw.length,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      keys: json && typeof json === 'object' ? Object.keys(json).slice(0, 40) : null,
    })
    return null
  }
  return parsed.data
}

/**
 * The email's own Message-ID header, which is what a reply will quote back in
 * In-Reply-To. Postmark's top-level MessageID is its delivery id and would
 * never appear in anyone's headers, so it is only a last-resort key to keep the
 * row unique and the endpoint idempotent.
 *
 * If both are missing the key is a digest of the payload, not a constant: a
 * retry sends byte-identical JSON and so still deduplicates, while two
 * different Message-ID-less emails stay distinct. A constant here would make
 * the second such email look like a duplicate of the first and be dropped.
 */
function inboundMessageId(payload: InboundPayload, raw: string): string {
  const header = parseMessageIds(findHeader(payload, 'message-id'))[0]
  if (header) return header

  const fallback = payload.MessageID
    ? `postmark-${payload.MessageID}`
    : `sha256-${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`

  log('warn', 'missing_message_id_header', {
    postmarkMessageId: payload.MessageID,
    from: payload.From,
    subject: payload.Subject.slice(0, 120),
    fallbackKey: fallback,
  })
  return `<${fallback}@inbound.invalid>`
}

function accepted(outcome: string): Response {
  return new Response(JSON.stringify({ outcome }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * One structured line per event. An unroutable or malformed payload has to be
 * debuggable from the log alone, without reproducing the email, so every field
 * needed to find it in Postmark's activity feed is here. The body is never
 * logged — it is customer content; only its length is.
 */
function log(level: 'info' | 'warn' | 'error', event: string, details: object): void {
  const line = `[postmark-inbound] ${event} ${JSON.stringify(details)}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}
