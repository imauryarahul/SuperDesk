'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { ActionError, toFormError, type FormState } from '@/lib/forms'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type AcceptInviteState = FormState & { notice?: string }

const acceptSchema = z.object({
  token: z.string().min(1),
  mode: z.enum(['signup', 'signin']),
  password: z.string().min(1, 'Password is required.'),
  fullName: z.string().trim().max(100).optional(),
})

/**
 * Handles both halves of requirement 5. `signup` is the invitee who has no
 * account; `signin` is the invitee who already does. Either way the profile is
 * only created by accept_workspace_invite, which re-checks the token, the
 * expiry and the email server-side.
 */
export async function acceptInviteAction(
  _prevState: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  let awaitingEmailConfirmation = false

  try {
    const parsed = acceptSchema.safeParse(Object.fromEntries(formData))
    if (!parsed.success) {
      throw new ActionError(parsed.error.issues[0]?.message ?? 'Check the form and try again.')
    }
    const { token, mode, password, fullName } = parsed.data

    const invite = await loadPendingInvite(token)

    const { userId, hasSession } =
      mode === 'signup'
        ? await signUpInvitee(invite.email, password, fullName)
        : await signInInvitee(invite.email, password)

    await joinWorkspace(userId, invite.email, token, fullName)
    awaitingEmailConfirmation = !hasSession
  } catch (error) {
    return toFormError(error, 'acceptInviteAction')
  }

  if (awaitingEmailConfirmation) {
    return {
      error: null,
      notice: 'You have joined the workspace. Confirm your email address, then sign in.',
    }
  }
  redirect('/inbox')
}

/** The invitee is already signed in with the right address; one click to join. */
export async function acceptInviteAsCurrentUserAction(formData: FormData): Promise<void> {
  const token = z.string().min(1).parse(formData.get('token'))

  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user?.email) throw new ActionError('You must be signed in to accept an invite.')

  await joinWorkspace(user.id, user.email, token, null)
  redirect('/inbox')
}

async function signUpInvitee(
  email: string,
  password: string,
  fullName: string | undefined,
): Promise<{ userId: string; hasSession: boolean }> {
  if (password.length < 8) throw new ActionError('Password must be at least 8 characters.')

  const { data, error } = await createClient().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName ?? null } },
  })

  if (error) throw new ActionError(error.message)
  if (!data.user) throw new ActionError('Could not create your account. Please try again.')
  if (data.user.identities?.length === 0) {
    throw new ActionError('You already have an account. Choose "I already have an account".')
  }

  return { userId: data.user.id, hasSession: data.session !== null }
}

async function signInInvitee(
  email: string,
  password: string,
): Promise<{ userId: string; hasSession: boolean }> {
  const { data, error } = await createClient().auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    throw new ActionError('Incorrect password for the invited email address.')
  }
  return { userId: data.user.id, hasSession: data.session !== null }
}

async function joinWorkspace(
  authUserId: string,
  email: string,
  token: string,
  fullName: string | null | undefined,
): Promise<void> {
  const { error } = await createAdminClient().rpc('accept_workspace_invite', {
    p_auth_user_id: authUserId,
    p_email: email,
    p_token: token,
    p_full_name: fullName ?? undefined,
  })
  if (error) throw new ActionError(describeInviteError(error.message))
}

async function loadPendingInvite(token: string): Promise<{ email: string }> {
  const { data, error } = await createAdminClient()
    .from('workspace_invites')
    .select('email, accepted_at, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new ActionError('This invite link is not valid.')
  if (data.accepted_at) throw new ActionError('This invite has already been used.')
  if (new Date(data.expires_at) <= new Date()) {
    throw new ActionError('This invite has expired. Ask an admin for a new one.')
  }
  return { email: data.email }
}

function describeInviteError(message: string): string {
  if (message.includes('invite_not_found')) return 'This invite link is not valid.'
  if (message.includes('invite_already_accepted')) return 'This invite has already been used.'
  if (message.includes('invite_expired')) {
    return 'This invite has expired. Ask an admin for a new one.'
  }
  if (message.includes('invite_email_mismatch')) {
    return 'This invite was sent to a different email address.'
  }
  if (message.includes('already_in_another_workspace')) {
    return 'Your account already belongs to another workspace.'
  }
  return 'Could not join the workspace. Please try again.'
}
