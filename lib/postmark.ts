import 'server-only'

import { randomUUID } from 'node:crypto'

import { postmarkFromEmail, postmarkInboundAddress, postmarkServerToken } from '@/lib/env'

const SEND_ENDPOINT = 'https://api.postmarkapp.com/email'
const SEND_TIMEOUT_MS = 10_000

/**
 * The workspace's own inbound address: the account-wide inbound address with
 * the workspace's token as a plus-suffix. Postmark reports that suffix back as
 * MailboxHash on the inbound webhook, which is how a delivery is attributed to
 * a tenant.
 */
export function inboundAddressFor(inboundToken: string): string {
  const [localPart, domain] = splitAddress(postmarkInboundAddress())
  // The configured address may already carry a suffix; ours replaces it.
  return `${localPart.split('+')[0]}+${inboundToken}@${domain}`
}

/**
 * A Message-ID we own, so threading does not depend on parsing Postmark's.
 *
 * Postmark's send API returns a `MessageID` for its own activity log, not the
 * RFC 5322 `Message-ID` header the recipient's mail client sees and quotes back
 * in `In-Reply-To`. Those are different values, so we mint the header ourselves
 * and tell Postmark to keep it (see X-PM-KeepID below). The domain matches the
 * From address so the id aligns with the sending domain.
 */
export function newMessageId(): string {
  const [, domain] = splitAddress(postmarkFromEmail())
  return `<${randomUUID()}@${domain}>`
}

/** `Re: x` once, not `Re: Re: x`. */
export function replySubject(subject: string | null): string {
  const trimmed = subject?.trim()
  if (!trimmed) return 'Re: (no subject)'
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

export interface SendEmailInput {
  to: string
  subject: string
  textBody: string
  /** Where customer replies must land: the workspace's inbound plus-address. */
  replyTo: string
  /** The RFC Message-ID this email will carry, from newMessageId(). */
  messageId: string
  /** Parent message's Message-ID, so mail clients thread the reply visibly. */
  inReplyTo: string | null
  /** Full known chain, oldest first. RFC 5322 recommends it alongside In-Reply-To. */
  references: string[]
}

export type SendEmailResult =
  | { ok: true; postmarkMessageId: string }
  | { ok: false; error: string }

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const headers: Array<{ Name: string; Value: string }> = [
    { Name: 'Message-ID', Value: input.messageId },
    // Without this Postmark replaces our Message-ID with its own, and the
    // In-Reply-To on the customer's reply would match nothing we stored.
    { Name: 'X-PM-KeepID', Value: 'true' },
  ]
  if (input.inReplyTo) headers.push({ Name: 'In-Reply-To', Value: input.inReplyTo })
  if (input.references.length > 0) {
    headers.push({ Name: 'References', Value: input.references.join(' ') })
  }

  try {
    const res = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': postmarkServerToken(),
      },
      body: JSON.stringify({
        From: postmarkFromEmail(),
        To: input.to,
        ReplyTo: input.replyTo,
        Subject: input.subject,
        TextBody: input.textBody,
        Headers: headers,
        MessageStream: 'outbound',
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })

    const payload: unknown = await res.json().catch(() => null)

    if (!res.ok) {
      const detail = describePostmarkError(payload)
      console.error(`[postmark] send failed ${res.status}: ${detail}`)
      return { ok: false, error: detail }
    }

    const postmarkMessageId = readMessageId(payload)
    if (!postmarkMessageId) {
      console.error('[postmark] send returned 200 with no MessageID:', payload)
      return { ok: false, error: 'Postmark accepted the email but returned no MessageID.' }
    }

    return { ok: true, postmarkMessageId }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[postmark] send network error:', detail)
    return { ok: false, error: detail }
  }
}

function splitAddress(address: string): [string, string] {
  const at = address.lastIndexOf('@')
  return [address.slice(0, at), address.slice(at + 1)]
}

function describePostmarkError(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const { ErrorCode, Message } = payload as { ErrorCode?: unknown; Message?: unknown }
    if (typeof Message === 'string') {
      return typeof ErrorCode === 'number' ? `${Message} (ErrorCode ${ErrorCode})` : Message
    }
  }
  return 'Postmark rejected the request.'
}

function readMessageId(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const { MessageID } = payload as { MessageID?: unknown }
    if (typeof MessageID === 'string' && MessageID.length > 0) return MessageID
  }
  return null
}
