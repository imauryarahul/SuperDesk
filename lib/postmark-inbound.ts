import 'server-only'

import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { postmarkInboundWebhookCredentials } from '@/lib/env'

/**
 * Postmark's published webhook source IPs, which apply to every webhook type.
 * https://postmarkapp.com/support/article/800-ips-for-firewalls
 *
 * A hardcoded list is a deliberate trade-off: it is the second layer behind
 * Basic Auth, and if Postmark ever changes it the failure is a loud 403 plus a
 * log line naming the rejected IP, not silent data loss.
 */
export const POSTMARK_WEBHOOK_IPS: readonly string[] = [
  '3.134.147.250',
  '50.31.156.6',
  '50.31.156.77',
  '18.217.206.57',
]

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

const HeaderSchema = z.object({ Name: z.string(), Value: z.string() })

const RecipientSchema = z.object({
  Email: z.string().default(''),
  Name: z.string().default(''),
  MailboxHash: z.string().default(''),
})

/**
 * Deliberately lenient. Postmark adds fields over time and a real email can
 * leave almost anything blank, so only the sender address is truly required —
 * without it there is no contact to attribute the message to. Unknown keys are
 * stripped rather than rejected.
 */
export const InboundPayloadSchema = z.object({
  From: z.string(),
  FromName: z.string().default(''),
  FromFull: RecipientSchema.optional(),
  ToFull: z.array(RecipientSchema).default([]),
  OriginalRecipient: z.string().default(''),
  Subject: z.string().default(''),
  /** Postmark's own delivery id, not the RFC Message-ID. Logged, not stored. */
  MessageID: z.string().default(''),
  MailboxHash: z.string().default(''),
  Date: z.string().default(''),
  TextBody: z.string().default(''),
  HtmlBody: z.string().default(''),
  StrippedTextReply: z.string().default(''),
  Headers: z.array(HeaderSchema).default([]),
})

export type InboundPayload = z.infer<typeof InboundPayloadSchema>

// ---------------------------------------------------------------------------
// Request verification
// ---------------------------------------------------------------------------

export type VerifyResult = { ok: true } | { ok: false; status: number; reason: string }

/**
 * Basic Auth first, then source IP. Both failures return a non-200, which is
 * correct: Postmark's retry policy only matters for deliveries we accept, and
 * an unauthenticated caller should never be told its payload was stored.
 */
export function verifyInboundRequest(request: Request, clientIp: string | null): VerifyResult {
  const credentials = postmarkInboundWebhookCredentials()
  const supplied = parseBasicAuth(request.headers.get('authorization'))

  if (!supplied) {
    return { ok: false, status: 401, reason: 'Missing or malformed Basic Auth credentials' }
  }
  if (
    !constantTimeEquals(supplied.user, credentials.user) ||
    !constantTimeEquals(supplied.pass, credentials.pass)
  ) {
    return { ok: false, status: 401, reason: 'Basic Auth credentials do not match' }
  }

  // Local and preview testing goes through ngrok or curl, which never presents
  // a Postmark IP. Basic Auth still applies there.
  if (process.env.NODE_ENV !== 'production') return { ok: true }

  if (!clientIp) {
    return { ok: false, status: 403, reason: 'No client IP available to check' }
  }
  if (!POSTMARK_WEBHOOK_IPS.includes(clientIp)) {
    return { ok: false, status: 403, reason: `Source IP ${clientIp} is not a Postmark webhook IP` }
  }

  return { ok: true }
}

/** Vercel puts the real client first in x-forwarded-for. */
export function clientIpFrom(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || null
}

function parseBasicAuth(header: string | null): { user: string; pass: string } | null {
  if (!header?.toLowerCase().startsWith('basic ')) return null
  let decoded: string
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
  } catch {
    return null
  }
  const separator = decoded.indexOf(':')
  if (separator < 0) return null
  return { user: decoded.slice(0, separator), pass: decoded.slice(separator + 1) }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on a length mismatch, which leaks length by itself.
  // Hashing to a fixed width would be tidier; a length check is enough here
  // because the value is a configured secret, not user-chosen.
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

export function findHeader(payload: InboundPayload, name: string): string | null {
  const wanted = name.toLowerCase()
  const match = payload.Headers.find((h) => h.Name.toLowerCase() === wanted)
  return match?.Value.trim() || null
}

/**
 * Pulls the `<...>` tokens out of a Message-ID, In-Reply-To or References
 * header. In-Reply-To is specified as a single id but real mail clients send
 * several, and References is always a list, so both are handled the same way.
 */
export function parseMessageIds(value: string | null): string[] {
  if (!value) return []
  const matches = value.match(/<[^<>\s]+>/g)
  if (matches) return matches
  // Some senders omit the angle brackets. Salvage a bare addr-spec.
  const bare = value.trim()
  return bare && !bare.includes(' ') ? [`<${bare}>`] : []
}

/**
 * The workspace routing token. The top-level MailboxHash is the documented
 * source, but it is empty when our inbound address was on Cc rather than To,
 * so the per-recipient hashes are a fallback.
 */
export function extractMailboxHash(payload: InboundPayload): string | null {
  if (payload.MailboxHash.trim()) return payload.MailboxHash.trim()
  for (const recipient of payload.ToFull) {
    if (recipient.MailboxHash.trim()) return recipient.MailboxHash.trim()
  }
  return null
}

export function extractSenderEmail(payload: InboundPayload): string | null {
  const raw = payload.FromFull?.Email || payload.From
  // `"Alan Turing" <alan@example.com>` or a bare address.
  const angled = raw.match(/<([^<>]+)>/)
  const address = (angled ? angled[1] : raw).trim().toLowerCase()
  return address.includes('@') ? address : null
}

/**
 * StrippedTextReply is the new text with the quoted thread removed, which is
 * what belongs in a conversation. It is empty on a first email (nothing to
 * strip) and on some HTML-only mail, so fall back through TextBody to a rough
 * de-tagged HtmlBody.
 */
export function extractBody(payload: InboundPayload): string {
  const stripped = payload.StrippedTextReply.trim()
  if (stripped) return stripped

  const text = payload.TextBody.trim()
  if (text) return text

  const fromHtml = payload.HtmlBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return fromHtml
}
