import { redirect } from 'next/navigation'

import { signOutAction } from '@/app/(auth)/actions'
import { Alert } from '@/components/ui'
import { getAuthState } from '@/lib/auth'

import { Sidebar } from './sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const state = await getAuthState()

  if (state.status === 'anonymous') redirect('/login')
  if (state.status === 'orphaned') return <OrphanedAccount email={state.email} />

  return (
    <div className="flex min-h-screen">
      <Sidebar
        workspaceName={state.workspace.name}
        displayName={state.profile.fullName ?? state.profile.email}
        role={state.profile.role}
      />
      <main className="min-w-0 flex-1 px-10 py-10">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  )
}

/**
 * Signup creates the auth user and the workspace atomically, so this should be
 * unreachable. It exists because the alternative — redirecting to /login while
 * a valid session exists — would bounce between middleware and this layout.
 */
function OrphanedAccount({ email }: { email: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h1 className="text-lg font-semibold">No workspace found</h1>
        <Alert tone="error">
          {email || 'This account'} is signed in but is not attached to a workspace. Sign out and
          create one, or ask an admin for an invite link.
        </Alert>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  )
}
