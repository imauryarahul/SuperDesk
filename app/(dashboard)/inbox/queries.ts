/**
 * Shared between the server component's first load and the client's own
 * re-fetches, so the two cannot drift apart.
 *
 * This file is intentionally free of 'use client' / 'use server' so it can be
 * imported by both RSC pages and client components without bundling issues.
 */

// ai_summary rides along so opening a thread renders the cached summary with no
// extra request — the panel only calls the API when it decides one is needed.
export const CONV_SELECT =
  'id, status, last_message_at, channel, subject, assigned_agent_id, ai_summary, ai_summary_inbound_count, contacts(id, email, anonymous_token)'

// ---------------------------------------------------------------------------
// Filter types shared between page.tsx (server) and inbox-client.tsx (client)
// ---------------------------------------------------------------------------

export type InboxFilter = {
  status: 'open' | 'snoozed' | 'resolved' | 'all'
  channel: 'chat' | 'email' | 'all'
  /** 'all' | 'me' | 'unassigned' | <agent-profile-id> */
  assignee: string
}

export type AgentProfile = {
  id: string
  full_name: string | null
  email: string
}

export const DEFAULT_FILTER: InboxFilter = {
  status: 'open',
  channel: 'all',
  assignee: 'all',
}

/**
 * Derives a typed InboxFilter from URL searchParams. Unknown values fall back
 * to the default so a crafted URL cannot inject unexpected DB filter values.
 */
export function parseInboxFilter(
  params: Record<string, string | string[] | undefined>,
): InboxFilter {
  const get = (k: string): string | undefined => {
    const v = params[k]
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined
  }

  const rawStatus = get('status')
  const rawChannel = get('channel')
  const rawAssignee = get('assignee')

  const status = (['open', 'snoozed', 'resolved', 'all'] as const).includes(
    rawStatus as InboxFilter['status'],
  )
    ? (rawStatus as InboxFilter['status'])
    : DEFAULT_FILTER.status

  const channel = (['chat', 'email', 'all'] as const).includes(
    rawChannel as InboxFilter['channel'],
  )
    ? (rawChannel as InboxFilter['channel'])
    : DEFAULT_FILTER.channel

  // assignee can be 'all', 'me', 'unassigned', or a UUID (agent id).
  // We accept it as-is; the server action validates the UUID if provided.
  const assignee = rawAssignee ?? DEFAULT_FILTER.assignee

  return { status, channel, assignee }
}

/** Serialises a filter back to URL search params (omitting defaults). */
export function filterToParams(f: InboxFilter): string {
  const params = new URLSearchParams()
  if (f.status !== DEFAULT_FILTER.status) params.set('status', f.status)
  if (f.channel !== DEFAULT_FILTER.channel) params.set('channel', f.channel)
  if (f.assignee !== DEFAULT_FILTER.assignee) params.set('assignee', f.assignee)
  return params.toString()
}
