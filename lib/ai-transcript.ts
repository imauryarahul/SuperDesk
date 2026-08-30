/**
 * Shared transcript shaping for issue summaries and reply drafts.
 *
 * Caps exist so a huge thread is described by its current state, not its
 * entire history, and so a single request cannot blow the token budget.
 * Character counts are a stand-in for tokens: cheap, deterministic, and
 * close enough at this scale.
 */

export const MAX_RECENT_MESSAGES = 40
export const MAX_CHARS_PER_MESSAGE = 600
export const MAX_TRANSCRIPT_CHARS = 10_000

export type TranscriptLine = {
  sender_type: 'contact' | 'agent' | 'system'
  body: string
}

const LABELS: Record<TranscriptLine['sender_type'], string> = {
  contact: 'customer',
  agent: 'agent',
  system: 'system',
}

export function clipBody(body: string, max = MAX_CHARS_PER_MESSAGE): string {
  const trimmed = body.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

/**
 * Keep the most recent end of the thread, bounded by message count and a
 * character budget — whichever binds first.
 */
export function capTranscript(messages: TranscriptLine[]): TranscriptLine[] {
  const window = messages.slice(-MAX_RECENT_MESSAGES)
  const kept: TranscriptLine[] = []
  let chars = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const row = window[i]
    if (!row) continue
    const body = clipBody(row.body)
    if (!body) continue
    if (kept.length > 0 && chars + body.length > MAX_TRANSCRIPT_CHARS) break
    kept.push({ sender_type: row.sender_type, body })
    chars += body.length
  }
  return kept.reverse()
}

export function formatTranscript(messages: TranscriptLine[]): string {
  return messages.map((m) => `${LABELS[m.sender_type]}: ${m.body}`).join('\n')
}

export function latestCustomerBody(messages: TranscriptLine[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i]
    if (row && row.sender_type === 'contact' && row.body.trim()) return row.body.trim()
  }
  return null
}
