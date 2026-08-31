import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

/**
 * Postgres `numeric` is serialized by PostgREST as a JSON string (to avoid
 * float precision loss), while `bigint` arrives as a number. Everything from
 * an aggregate goes through here so a null or an unparseable value becomes
 * null rather than NaN leaking into the rendered output.
 */
function toNumberOrNull(value: string | number | null): number | null {
  if (value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Shared formatting helpers (used by the page component)
// ---------------------------------------------------------------------------

/**
 * Re-exported rather than defined here: the SLA badge needs the same formatting
 * in a client component, and this module is server-only.
 */
export { formatDuration } from '@/lib/sla'

/** Returns "HH:00 – HH+1:00" label for a 0–23 hour bucket. */
export function formatHourLabel(hour: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hour)}:00`
}

// ---------------------------------------------------------------------------
// First-response time
// ---------------------------------------------------------------------------

export type FirstResponseStats = {
  avgSeconds: number | null
  medianSeconds: number | null
  p95Seconds: number | null
  /** Conversations that had at least one agent reply after the first contact message. */
  measuredCount: number
}

export async function fetchFirstResponseStats(supabase: Client): Promise<FirstResponseStats> {
  const { data, error } = await supabase.rpc('get_analytics_first_response')
  if (error) throw new Error(`analytics/first_response: ${error.message}`)

  const row = data?.[0]
  if (!row) return { avgSeconds: null, medianSeconds: null, p95Seconds: null, measuredCount: 0 }

  return {
    avgSeconds: toNumberOrNull(row.avg_seconds),
    medianSeconds: toNumberOrNull(row.median_seconds),
    p95Seconds: toNumberOrNull(row.p95_seconds),
    measuredCount: toNumberOrNull(row.measured_count) ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Resolution rate
// ---------------------------------------------------------------------------

export type ResolutionRate = {
  resolvedCount: number
  totalCount: number
}

export async function fetchResolutionRate(supabase: Client): Promise<ResolutionRate> {
  const { data, error } = await supabase.rpc('get_analytics_resolution_rate')
  if (error) throw new Error(`analytics/resolution_rate: ${error.message}`)

  const row = data?.[0]
  if (!row) return { resolvedCount: 0, totalCount: 0 }

  return {
    resolvedCount: toNumberOrNull(row.resolved_count) ?? 0,
    totalCount: toNumberOrNull(row.total_count) ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Busiest hours
// ---------------------------------------------------------------------------

export type HourBucket = {
  hour: number
  messageCount: number
}

export async function fetchBusiestHours(supabase: Client): Promise<HourBucket[]> {
  const { data, error } = await supabase.rpc('get_analytics_busiest_hours')
  if (error) throw new Error(`analytics/busiest_hours: ${error.message}`)

  // The RPC only returns hours that have messages; fill in 0 for the rest so
  // the bar chart always renders a full 24-hour row.
  const byHour = new Map<number, number>()
  for (const row of data ?? []) {
    const hour = toNumberOrNull(row.hour)
    if (hour === null) continue
    byHour.set(hour, toNumberOrNull(row.message_count) ?? 0)
  }

  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    messageCount: byHour.get(h) ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// Per-agent stats
// ---------------------------------------------------------------------------

export type AgentStat = {
  agentId: string
  fullName: string | null
  email: string
  conversationsResolved: number
  /** null when the agent has no measured first-response times */
  avgFirstResponseSecs: number | null
}

export async function fetchAgentStats(supabase: Client): Promise<AgentStat[]> {
  const { data, error } = await supabase.rpc('get_analytics_agent_stats')
  if (error) throw new Error(`analytics/agent_stats: ${error.message}`)

  return (data ?? []).map((row) => ({
    agentId: row.agent_id,
    fullName: row.full_name,
    email: row.agent_email,
    conversationsResolved: toNumberOrNull(row.conversations_resolved) ?? 0,
    avgFirstResponseSecs: toNumberOrNull(row.avg_first_response_secs),
  }))
}
