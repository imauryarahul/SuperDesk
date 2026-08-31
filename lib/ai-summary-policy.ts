/**
 * When a conversation summary is worth a model call.
 *
 * Imported by both the inbox panel and the summarization endpoint so the client
 * does not fire requests the server would refuse, and the server stays the
 * authority on spend regardless of what the client asks for. No 'server-only'
 * here for that reason.
 */

/** Below this, the thread is shorter than the summary would be. */
export const MIN_MESSAGES_FOR_SUMMARY = 3

/**
 * New customer messages required before an existing summary is regenerated.
 * A lone "thanks!" does not justify a call; the agent can still force one.
 */
export const STALE_INBOUND_THRESHOLD = 2

/** A generation claim older than this is treated as abandoned. */
export const GENERATION_LOCK_MS = 30_000

export type SummaryState = {
  hasSummary: boolean
  messageCount: number
  /** Customer messages in the thread now. */
  inboundCount: number
  /** Customer messages the stored summary reflects. */
  summarizedInboundCount: number
}

/** True when the stored summary is behind the thread at all, however slightly. */
export function isSummaryStale(state: SummaryState): boolean {
  if (!state.hasSummary) return false
  return state.inboundCount > state.summarizedInboundCount
}

/** True when the gap is wide enough to spend a model call on unprompted. */
export function shouldGenerateSummary(state: SummaryState): boolean {
  if (state.messageCount < MIN_MESSAGES_FOR_SUMMARY) return false
  if (!state.hasSummary) return true
  return state.inboundCount - state.summarizedInboundCount >= STALE_INBOUND_THRESHOLD
}
