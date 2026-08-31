import { requireWorkspace } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { InfoTooltip } from '@/components/info-tooltip'
import {
  fetchAgentStats,
  fetchBusiestHours,
  fetchFirstResponseStats,
  fetchResolutionRate,
  formatDuration,
  formatHourLabel,
  type AgentStat,
  type FirstResponseStats,
  type HourBucket,
  type ResolutionRate,
} from '@/lib/analytics'

export const metadata = { title: 'Analytics' }

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AnalyticsPage() {
  await requireWorkspace()
  const supabase = createClient()

  let firstResponse: FirstResponseStats
  let resolutionRate: ResolutionRate
  let busiestHours: HourBucket[]
  let agentStats: AgentStat[]
  let fetchError: string | null = null

  try {
    ;[firstResponse, resolutionRate, busiestHours, agentStats] = await Promise.all([
      fetchFirstResponseStats(supabase),
      fetchResolutionRate(supabase),
      fetchBusiestHours(supabase),
      fetchAgentStats(supabase),
    ])
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown error'
    firstResponse = { avgSeconds: null, medianSeconds: null, p95Seconds: null, measuredCount: 0 }
    resolutionRate = { resolvedCount: 0, totalCount: 0 }
    busiestHours = Array.from({ length: 24 }, (_, h) => ({ hour: h, messageCount: 0 }))
    agentStats = []
  }

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-8 py-6">
        <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Workspace-wide metrics, computed on-the-fly from all conversations. No date range
          filter — all-time figures only.
        </p>
      </div>

      <div className="px-8 py-8 space-y-8">
        {fetchError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load analytics: {fetchError}
          </div>
        ) : null}

        {/* ── Top stat cards ─────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-3">
          <FirstResponseCard data={firstResponse} />
          <ResolutionRateCard data={resolutionRate} />
          <TotalConversationsCard data={resolutionRate} />
        </div>

        {/* ── Busiest hours ──────────────────────────────────────────── */}
        <BusiestHoursSection data={busiestHours} />

        {/* ── Per-agent breakdown ────────────────────────────────────── */}
        <AgentStatsSection data={agentStats} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  tooltip,
  empty,
}: {
  label: string
  value: string
  sub?: string
  tooltip: string
  empty?: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <InfoTooltip content={tooltip} />
      </div>
      {empty ? (
        <p className="mt-3 text-sm text-slate-400">Not enough data yet</p>
      ) : (
        <>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
          {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
        </>
      )}
    </div>
  )
}

function FirstResponseCard({ data }: { data: FirstResponseStats }) {
  const empty = data.measuredCount === 0

  return (
    <StatCard
      label="Avg first response"
      value={formatDuration(data.avgSeconds)}
      sub={
        empty
          ? undefined
          : `Median ${formatDuration(data.medianSeconds)} · P95 ${formatDuration(data.p95Seconds)} · ${data.measuredCount.toLocaleString()} conversations measured`
      }
      tooltip="Time from the first contact message to the first agent reply. Simplification: no adjustment for snoozed time; no per-reopen recalculation — just the first-ever agent reply vs the first-ever contact message."
      empty={empty}
    />
  )
}

function ResolutionRateCard({ data }: { data: ResolutionRate }) {
  const empty = data.totalCount === 0
  const pct =
    data.totalCount > 0 ? Math.round((data.resolvedCount / data.totalCount) * 100) : 0

  return (
    <StatCard
      label="Resolution rate"
      value={empty ? '—' : `${pct}%`}
      sub={
        empty
          ? undefined
          : `${data.resolvedCount.toLocaleString()} of ${data.totalCount.toLocaleString()} conversations resolved`
      }
      tooltip="Percentage of all conversations that are currently resolved (resolved ÷ total). A conversation that was resolved and later reopened counts as open until it is resolved again."
      empty={empty}
    />
  )
}

function TotalConversationsCard({ data }: { data: ResolutionRate }) {
  const open = data.totalCount - data.resolvedCount
  const empty = data.totalCount === 0

  return (
    <StatCard
      label="Total conversations"
      value={empty ? '—' : data.totalCount.toLocaleString()}
      sub={
        empty
          ? undefined
          : `${data.resolvedCount.toLocaleString()} resolved · ${open.toLocaleString()} open / snoozed`
      }
      tooltip="Count of every conversation in this workspace, across chat and email. The subtitle splits that total into currently resolved vs open or snoozed. All-time; no date range filter."
      empty={empty}
    />
  )
}

// ---------------------------------------------------------------------------
// Busiest hours bar chart (CSS-only, no library)
// ---------------------------------------------------------------------------

function BusiestHoursSection({ data }: { data: HourBucket[] }) {
  const totalMessages = data.reduce((sum, b) => sum + b.messageCount, 0)
  const maxCount = Math.max(...data.map((b) => b.messageCount), 1)
  const hasData = totalMessages > 0

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Busiest hours</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Message volume by hour of day (UTC), both channels combined.
          </p>
        </div>
        {hasData ? (
          <p className="shrink-0 text-xs text-slate-500">
            {totalMessages.toLocaleString()} messages total
          </p>
        ) : null}
      </div>

      {!hasData ? (
        <p className="py-4 text-center text-sm text-slate-400">Not enough data yet</p>
      ) : (
        <div className="space-y-1">
          {data.map(({ hour, messageCount }) => {
            const widthPct = (messageCount / maxCount) * 100
            return (
              <div key={hour} className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {formatHourLabel(hour)}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded-sm bg-slate-100">
                  <div
                    className="h-full rounded-sm bg-slate-800 transition-all"
                    style={{ width: messageCount === 0 ? '0%' : `${widthPct}%` }}
                    aria-label={`${messageCount} messages`}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {messageCount > 0 ? messageCount.toLocaleString() : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Per-agent breakdown table
// ---------------------------------------------------------------------------

function AgentStatsSection({ data }: { data: AgentStat[] }) {
  const hasData = data.length > 0

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Per-agent breakdown</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Resolved conversations and average first-response time, per team member.
        </p>
      </div>

      {!hasData ? (
        <p className="px-6 py-8 text-center text-sm text-slate-400">Not enough data yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Agent
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                  Resolved
                </th>
                <th
                  className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500"
                  title="Average time from first contact message to first agent reply, for conversations assigned to this agent."
                >
                  Avg first response ⓘ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((agent) => (
                <AgentRow key={agent.agentId} agent={agent} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AgentRow({ agent }: { agent: AgentStat }) {
  const displayName = agent.fullName ?? agent.email
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
            {initials}
          </span>
          <div>
            <p className="font-medium text-slate-900">{displayName}</p>
            {agent.fullName ? (
              <p className="text-xs text-slate-500">{agent.email}</p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-6 py-3 text-right tabular-nums text-slate-700">
        {agent.conversationsResolved > 0
          ? agent.conversationsResolved.toLocaleString()
          : <span className="text-slate-400">0</span>}
      </td>
      <td className="px-6 py-3 text-right tabular-nums text-slate-700">
        {agent.avgFirstResponseSecs !== null
          ? formatDuration(agent.avgFirstResponseSecs)
          : <span className="text-slate-400">—</span>}
      </td>
    </tr>
  )
}
