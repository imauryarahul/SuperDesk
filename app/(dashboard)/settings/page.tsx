import { Alert, RoleBadge } from '@/components/ui'
import { requireWorkspace } from '@/lib/auth'
import { appUrl } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'

import { revokeInviteAction } from './actions'
import { CopyLink } from './copy-link'
import { InviteForm } from './invite-form'

export const metadata = { title: 'Settings · SuperDesk' }

export default async function SettingsPage() {
  const { profile, workspace } = await requireWorkspace()
  const isAdmin = profile.role === 'admin'

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">Workspace and team.</p>

      <div className="mt-6 space-y-6">
        <Card title="Workspace">
          <dl className="text-sm">
            <dt className="text-slate-500">Name</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{workspace.name}</dd>
          </dl>
        </Card>

        <Card title="Team">
          <TeamList currentProfileId={profile.id} />
        </Card>

        {isAdmin ? (
          <>
            <Card title="Invite a teammate">
              <InviteForm />
            </Card>
            <Card title="Pending invites">
              <PendingInvites />
            </Card>
          </>
        ) : null}
      </div>
    </>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

async function TeamList({ currentProfileId }: { currentProfileId: string }) {
  // RLS restricts this to the caller's workspace; no workspace_id filter needed.
  const { data, error } = await createClient()
    .from('profiles')
    .select('id, email, full_name, role')
    .order('created_at')

  if (error) return <Alert tone="error">Could not load your team: {error.message}</Alert>

  return (
    <ul className="divide-y divide-slate-100">
      {data.map((member) => (
        <li key={member.id} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">
              {member.full_name ?? member.email}
              {member.id === currentProfileId ? (
                <span className="ml-2 text-xs font-normal text-slate-400">you</span>
              ) : null}
            </p>
            {member.full_name ? (
              <p className="truncate text-xs text-slate-500">{member.email}</p>
            ) : null}
          </div>
          <RoleBadge role={member.role} />
        </li>
      ))}
    </ul>
  )
}

async function PendingInvites() {
  const { data, error } = await createClient()
    .from('workspace_invites')
    .select('id, email, role, token, expires_at')
    .is('accepted_at', null)
    .order('created_at', { ascending: false })

  if (error) return <Alert tone="error">Could not load invites: {error.message}</Alert>
  if (data.length === 0) return <p className="text-sm text-slate-500">No pending invites.</p>

  return (
    <ul className="space-y-4">
      {data.map((invite) => (
        <li key={invite.id} className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{invite.email}</p>
              <p className="text-xs text-slate-500">
                Expires {new Date(invite.expires_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <RoleBadge role={invite.role} />
              <form action={revokeInviteAction}>
                <input type="hidden" name="inviteId" value={invite.id} />
                <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                  Revoke
                </button>
              </form>
            </div>
          </div>
          <CopyLink url={`${appUrl()}/invite/${invite.token}`} />
        </li>
      ))}
    </ul>
  )
}
