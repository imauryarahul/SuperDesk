import { cache } from 'react'

import { ActionError } from '@/lib/forms'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type UserRole = Database['public']['Enums']['user_role']

export type WorkspaceContext = {
  userId: string
  profile: { id: string; email: string; fullName: string | null; role: UserRole }
  workspace: { id: string; name: string; slug: string }
}

export type AuthState =
  | { status: 'anonymous' }
  /** Signed in, but the profile row is missing — signup was interrupted. */
  | { status: 'orphaned'; email: string }
  | ({ status: 'ready' } & WorkspaceContext)

/**
 * Cached for the lifetime of one render pass so a layout and the page inside
 * it share a single round trip.
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { status: 'anonymous' }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, workspaces (id, name, slug)')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error) {
    throw new Error(`Could not load your profile: ${error.message}`)
  }
  if (!data || !data.workspaces) {
    return { status: 'orphaned', email: user.email ?? '' }
  }

  return {
    status: 'ready',
    userId: user.id,
    profile: {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      role: data.role,
    },
    workspace: {
      id: data.workspaces.id,
      name: data.workspaces.name,
      slug: data.workspaces.slug,
    },
  }
})

/** For Route Handlers, where a missing session is a 401 rather than a thrown error. */
export async function getWorkspaceOrNull(): Promise<WorkspaceContext | null> {
  const state = await getAuthState()
  return state.status === 'ready' ? state : null
}

/** For server actions, where an unauthenticated caller is an error, not a redirect. */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const state = await getAuthState()
  if (state.status !== 'ready') {
    throw new ActionError('You must be signed in to a workspace to do that.')
  }
  return state
}

export async function requireAdmin(): Promise<WorkspaceContext> {
  const context = await requireWorkspace()
  if (context.profile.role !== 'admin') {
    throw new ActionError('Only workspace admins can do that.')
  }
  return context
}
