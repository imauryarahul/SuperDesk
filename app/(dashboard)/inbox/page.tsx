import { requireWorkspace } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

import { CONV_SELECT, InboxClient, type ConvRow } from './inbox-client'

export const metadata = { title: 'Inbox · SuperDesk' }

// This page is the entry point for the live chat view.
// It loads the initial conversation list server-side (fast first paint),
// then hands off to InboxClient which manages all realtime state.
export default async function InboxPage() {
  const { profile, workspace } = await requireWorkspace()
  const supabase = createClient()

  const { data } = await supabase
    .from('conversations')
    // Shared with the client's own re-fetch so both stay in step.
    .select(CONV_SELECT)
    .eq('workspace_id', workspace.id)
    .eq('status', 'open')
    .order('last_message_at', { ascending: false })
    .limit(50)

  const conversations = (data ?? []) as unknown as ConvRow[]

  return (
    <div className="flex h-full flex-col">
      <InboxClient
        workspaceId={workspace.id}
        profileId={profile.id}
        profileName={profile.fullName ?? profile.email}
        initialConversations={conversations}
      />
    </div>
  )
}
