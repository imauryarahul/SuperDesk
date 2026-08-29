import Link from 'next/link'

import { signOutAction } from '@/app/(auth)/actions'
import { Alert, RoleBadge, SubmitButton } from '@/components/ui'
import { getAuthState } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

import { AcceptInviteForm } from './accept-invite-form'
import { acceptInviteAsCurrentUserAction } from './actions'

export const metadata = { title: 'Join a workspace · SuperDesk' }

type Invite = {
  email: string
  role: Database['public']['Enums']['user_role']
  workspaceName: string
}

export default async function InvitePage({ params }: { params: { token: string } }) {
  const invite = await loadInvite(params.token)
  if ('problem' in invite) return <InviteProblem message={invite.problem} />

  const auth = await getAuthState()
  const signedInEmail =
    auth.status === 'ready' ? auth.profile.email : auth.status === 'orphaned' ? auth.email : null

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        Join {invite.workspaceName}
      </h1>
      <p className="mb-6 mt-1 flex items-center gap-2 text-sm text-slate-500">
        <span className="truncate">{invite.email}</span>
        <RoleBadge role={invite.role} />
      </p>

      {signedInEmail === null ? (
        <AcceptInviteForm token={params.token} email={invite.email} />
      ) : signedInEmail === invite.email ? (
        <form action={acceptInviteAsCurrentUserAction} className="space-y-4">
          <input type="hidden" name="token" value={params.token} />
          <SubmitButton pendingLabel="Joining…">Accept invite</SubmitButton>
        </form>
      ) : (
        <div className="space-y-4">
          <Alert tone="error">
            You are signed in as <strong>{signedInEmail}</strong>, but this invite is for{' '}
            <strong>{invite.email}</strong>. Sign out to accept it.
          </Alert>
          <form action={signOutAction}>
            <SubmitButton variant="secondary">Sign out</SubmitButton>
          </form>
        </div>
      )}
    </>
  )
}

/**
 * Read with the service-role client: the invitee is not in the workspace yet,
 * so no policy can grant them this row. Possession of the 32-byte token is the
 * authorisation, which is why it is validated before anything is rendered.
 */
async function loadInvite(token: string): Promise<Invite | { problem: string }> {
  const { data, error } = await createAdminClient()
    .from('workspace_invites')
    .select('email, role, accepted_at, expires_at, workspaces (name)')
    .eq('token', token)
    .maybeSingle()

  if (error) return { problem: 'Could not load this invite. Please try again.' }
  if (!data || !data.workspaces) return { problem: 'This invite link is not valid.' }
  if (data.accepted_at) return { problem: 'This invite has already been used.' }
  if (new Date(data.expires_at) <= new Date()) {
    return { problem: 'This invite has expired. Ask an admin for a new one.' }
  }

  return { email: data.email, role: data.role, workspaceName: data.workspaces.name }
}

function InviteProblem({ message }: { message: string }) {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Invite unavailable</h1>
      <Alert tone="error">{message}</Alert>
      <p className="mt-6 text-sm text-slate-500">
        <Link href="/login" className="font-medium text-slate-900 underline underline-offset-4">
          Go to sign in
        </Link>
      </p>
    </>
  )
}
