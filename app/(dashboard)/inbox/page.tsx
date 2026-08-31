import { requireWorkspace } from '@/lib/auth'
import { fetchConversationsSla } from '@/lib/sla'
import { createClient } from '@/lib/supabase/server'

import { InboxClient, type ConvRow } from './inbox-client'
import { type AgentProfile, CONV_SELECT, parseInboxFilter } from './queries'

export const metadata = { title: 'Inbox · SuperDesk' }

// This page is the entry point for the live inbox.
// It loads the initial conversation list server-side (fast first paint),
// then hands off to InboxClient which manages all realtime state.
//
// searchParams are used to initialise the filter from the URL. The client
// component writes filter changes back to the URL via window.history.replaceState
// so it does not trigger an RSC re-render on every filter click, while still
// making filtered views shareable and refresh-safe.
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const { profile, workspace } = await requireWorkspace()
  const supabase = createClient()

  const filter = parseInboxFilter(searchParams)

  // Build the conversation query with all active filter dimensions.
  let query = supabase
    .from('conversations')
    .select(CONV_SELECT)
    .eq('workspace_id', workspace.id)
    .order('last_message_at', { ascending: false })
    .limit(50)

  if (filter.status !== 'all') {
    query = query.eq('status', filter.status)
  }
  if (filter.channel !== 'all') {
    query = query.eq('channel', filter.channel)
  }
  if (filter.assignee === 'me') {
    query = query.eq('assigned_agent_id', profile.id)
  } else if (filter.assignee === 'unassigned') {
    query = query.is('assigned_agent_id', null)
  } else if (filter.assignee !== 'all') {
    // Specific agent ID — validated client-side as a UUID; the DB enforces the
    // FK so an invalid ID simply returns zero rows.
    query = query.eq('assigned_agent_id', filter.assignee)
  }

  const { data } = await query
  const conversations = (data ?? []) as unknown as ConvRow[]

  // All agents in this workspace, used to populate the assignee pickers.
  // SLA is fetched for the whole page in one RPC, not per row, and only after
  // the conversation ids are known — so it is sequential with the list query but
  // parallel with the agent list.
  const [agentsResult, slaMap] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('workspace_id', workspace.id)
      .order('full_name', { ascending: true, nullsFirst: false }),
    fetchConversationsSla(
      supabase,
      conversations.map((c) => c.id),
    ),
  ])

  return (
    <div className="flex h-full flex-col">
      <InboxClient
        workspaceId={workspace.id}
        profileId={profile.id}
        profileName={profile.fullName ?? profile.email}
        initialConversations={conversations}
        initialSla={Object.fromEntries(slaMap)}
        initialFilter={filter}
        agents={(agentsResult.data ?? []) as AgentProfile[]}
      />
    </div>
  )
}
