/**
 * SLA status, read side.
 *
 * Deliberately free of 'use client' / 'use server' / 'server-only' so the same
 * fetch runs in the inbox server component (first paint) and in the inbox client
 * component (which re-queries the conversation list on every filter change).
 * Two implementations would drift.
 *
 * Nothing here computes an SLA. The states come from
 * public.get_conversations_sla, which derives them from business hours in
 * Postgres; duplicating that arithmetic in TypeScript would give the badge and
 * the analytics count two different answers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export type SlaState = 'on_track' | 'approaching' | 'breached'

/**
 * The RPC returns the state as `text`, because a Postgres enum would need a
 * migration to add a state and the values only ever travel one way. This is the
 * boundary where it becomes a union — an unrecognised value is dropped rather
 * than cast, so a future state name renders as "no badge" instead of a blank
 * one.
 */
export function isSlaState(value: string | null): value is SlaState {
  return value === 'on_track' || value === 'approaching' || value === 'breached'
}

/** Worst-first, so the badge can show a single state for the whole conversation. */
const SEVERITY: Record<SlaState, number> = { breached: 3, approaching: 2, on_track: 1 }

export type SlaClock = {
  state: SlaState
  elapsedSeconds: number
  targetSeconds: number
  /**
   * When the clock stopped. Null while it is still running — which is what
   * makes an unanswered conversation drift into breach with no row change.
   */
  metAt: string | null
}

export type ConversationSla = {
  conversationId: string
  /** Null when the conversation has no contact message, so no clock ever started. */
  firstResponse: SlaClock | null
  resolution: SlaClock | null
}

/** The state a single badge should show: the worse of the two clocks. */
export function overallSlaState(sla: ConversationSla | undefined): SlaState | null {
  if (!sla) return null
  const states = [sla.firstResponse?.state, sla.resolution?.state].filter(isDefined)
  if (states.length === 0) return null
  return states.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst))
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  on_track: 'On track',
  approaching: 'Approaching SLA',
  breached: 'SLA breached',
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Converts a seconds value to a human-readable duration string. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const rem = s % 60
    return rem === 0 ? `${m}m` : `${m}m ${rem}s`
  }
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * Tooltip text for the badge. Says "business hours" explicitly because the
 * numbers look wrong otherwise — a customer who emailed on Saturday and got a
 * reply on Monday shows a few minutes elapsed, not two days.
 */
export function describeSla(sla: ConversationSla | undefined): string {
  if (!sla) return 'No SLA data'
  const parts: string[] = []

  if (sla.firstResponse) {
    const { state, elapsedSeconds, targetSeconds, metAt } = sla.firstResponse
    parts.push(
      `First response: ${formatDuration(elapsedSeconds)} of ${formatDuration(targetSeconds)}` +
        `${metAt ? '' : ' (still waiting)'} — ${SLA_STATE_LABEL[state].toLowerCase()}`,
    )
  }
  if (sla.resolution) {
    const { state, elapsedSeconds, targetSeconds } = sla.resolution
    parts.push(
      `Resolution: ${formatDuration(elapsedSeconds)} of ${formatDuration(targetSeconds)} — ` +
        SLA_STATE_LABEL[state].toLowerCase(),
    )
  }
  if (parts.length === 0) return 'No customer message yet, so no SLA clock has started'

  parts.push('Measured in business hours, excluding snoozed time.')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Business hours settings
// ---------------------------------------------------------------------------

/** ISO day-of-week, matching workspaces.business_days and Postgres `isodow`. */
export const BUSINESS_DAY_OPTIONS: ReadonlyArray<{ value: number; short: string; long: string }> = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
]

/** Postgres serializes `time` as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'. */
export function toTimeInputValue(pgTime: string): string {
  return pgTime.slice(0, 5)
}

export function formatBusinessDays(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  const labels = sorted
    .map((d) => BUSINESS_DAY_OPTIONS.find((o) => o.value === d)?.short)
    .filter((l): l is string => l !== undefined)

  if (labels.length === 0) return 'No working days'
  if (labels.length === 7) return 'Every day'

  // Collapse a contiguous run to "Mon–Fri"; anything else stays a list.
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1)
  if (contiguous && labels.length > 2) return `${labels[0]}–${labels[labels.length - 1]}`
  return labels.join(', ')
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * SLA for a batch of conversations, keyed by id.
 *
 * One round trip for the whole page, not one per row: the inbox renders up to 50
 * conversations and a per-row query would be 50 sequential requests behind the
 * same connection.
 *
 * A failure here returns an empty map rather than throwing. The SLA badge is
 * decoration on top of the inbox; an RPC error must not be what stops an agent
 * from reading their conversations.
 */
export async function fetchConversationsSla(
  supabase: Client,
  conversationIds: readonly string[],
): Promise<Map<string, ConversationSla>> {
  if (conversationIds.length === 0) return new Map()

  const { data, error } = await supabase.rpc('get_conversations_sla', {
    p_conversation_ids: [...conversationIds],
    p_unresolved_only: false,
  })

  if (error) {
    console.error('[sla] could not load conversation SLA:', error.message)
    return new Map()
  }

  const map = new Map<string, ConversationSla>()
  for (const row of data ?? []) {
    map.set(row.conversation_id, {
      conversationId: row.conversation_id,
      firstResponse: toClock(
        row.first_response_state,
        row.first_response_seconds,
        row.first_response_target_seconds,
        row.first_response_at,
      ),
      resolution: toClock(
        row.resolution_state,
        row.resolution_seconds,
        row.resolution_target_seconds,
        null,
      ),
    })
  }
  return map
}

function toClock(
  state: string | null,
  elapsedSeconds: number | null,
  targetSeconds: number,
  metAt: string | null,
): SlaClock | null {
  if (!isSlaState(state) || elapsedSeconds === null) return null
  return { state, elapsedSeconds, targetSeconds, metAt }
}

export type SlaBreachSummary = {
  /** Unresolved conversations breaching either clock. The two below overlap. */
  breachedCount: number
  firstResponseBreached: number
  resolutionBreached: number
  unresolvedCount: number
}

export async function fetchSlaBreachSummary(supabase: Client): Promise<SlaBreachSummary> {
  const { data, error } = await supabase.rpc('get_sla_breach_summary')
  if (error) throw new Error(`sla/breach_summary: ${error.message}`)

  const row = data?.[0]
  if (!row) {
    return {
      breachedCount: 0,
      firstResponseBreached: 0,
      resolutionBreached: 0,
      unresolvedCount: 0,
    }
  }

  return {
    breachedCount: row.breached_count,
    firstResponseBreached: row.first_response_breached,
    resolutionBreached: row.resolution_breached,
    unresolvedCount: row.unresolved_count,
  }
}
