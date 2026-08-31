import { describeSla, overallSlaState, type ConversationSla, type SlaState } from '@/lib/sla'

const TONE: Record<SlaState, { dot: string; pill: string; label: string }> = {
  on_track: { dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700', label: 'On track' },
  approaching: { dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700', label: 'Due soon' },
  breached: { dot: 'bg-red-500', pill: 'bg-red-50 text-red-700', label: 'Breached' },
}

/**
 * A single dot, for the inbox list rows. Deliberately not a pill: the rows
 * already carry a channel badge, a status pill, an unread dot and an assignee
 * picker, and a fourth labelled element makes the row unreadable.
 *
 * The full detail lives in the title attribute rather than a hover card, so it
 * costs nothing per row in a list of 50 and still works on a row that is itself
 * a click target.
 */
export function SlaDot({ sla }: { sla: ConversationSla | undefined }) {
  const state = overallSlaState(sla)
  if (!state) return null

  return (
    <span
      className="flex shrink-0 items-center"
      title={`${TONE[state].label} · SLA\n${describeSla(sla)}`}
    >
      <span className={`h-2 w-2 rounded-full ${TONE[state].dot}`} />
      <span className="sr-only">SLA {TONE[state].label}</span>
    </span>
  )
}

/** Labelled version for the thread header, where there is room for a word. */
export function SlaBadge({ sla }: { sla: ConversationSla | undefined }) {
  const state = overallSlaState(sla)
  if (!state) return null

  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${TONE[state].pill}`}
      title={describeSla(sla)}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE[state].dot}`} />
      SLA {TONE[state].label}
    </span>
  )
}
