'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth'
import { appUrl } from '@/lib/env'
import { ActionError, toFormError, type FormState } from '@/lib/forms'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type InviteFormState = FormState & { inviteUrl?: string; invitedEmail?: string }

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: z.enum(['admin', 'agent'], { message: 'Pick a role.' }),
})

export async function inviteTeammateAction(
  _prevState: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  try {
    const { profile, workspace } = await requireAdmin()
    const parsed = inviteSchema.safeParse(Object.fromEntries(formData))
    if (!parsed.success) {
      throw new ActionError(parsed.error.issues[0]?.message ?? 'Check the form and try again.')
    }
    const { email, role } = parsed.data

    if (email === profile.email) {
      throw new ActionError('That is your own email address.')
    }

    await assertEmailIsInvitable(email, workspace.id)

    // 32 random bytes: the link itself is the credential, so it has to be
    // unguessable. base64url keeps it safe to drop straight into a path.
    const token = randomBytes(32).toString('base64url')

    // Written through the user's own client, so the admin-only RLS policy on
    // workspace_invites is what actually authorises the insert.
    const supabase = createClient()
    const { error } = await supabase.from('workspace_invites').insert({
      workspace_id: workspace.id,
      email,
      role,
      token,
      invited_by: profile.id,
    })

    if (error) {
      if (error.code === '23505') {
        throw new ActionError(
          'There is already a pending invite for that email. Revoke it first to change the role.',
        )
      }
      throw error
    }

    revalidatePath('/settings')
    return { error: null, inviteUrl: `${appUrl()}/invite/${token}`, invitedEmail: email }
  } catch (error) {
    return toFormError(error, 'inviteTeammateAction')
  }
}

/**
 * A profile is pinned to exactly one workspace, so an address that already has
 * one can never accept. Catching it here gives the admin a real answer instead
 * of a link that fails a week later. Needs the admin client because the lookup
 * deliberately crosses workspace boundaries.
 */
async function assertEmailIsInvitable(email: string, workspaceId: string): Promise<void> {
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('workspace_id')
    .eq('email', email)
    .maybeSingle()

  if (error) throw error
  if (!data) return

  throw new ActionError(
    data.workspace_id === workspaceId
      ? 'That person is already on your team.'
      : 'That email already belongs to another SuperDesk workspace.',
  )
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  await requireAdmin()

  const inviteId = z.string().uuid().safeParse(formData.get('inviteId'))
  if (!inviteId.success) throw new ActionError('Invalid invite.')

  const supabase = createClient()
  const { error } = await supabase.from('workspace_invites').delete().eq('id', inviteId.data)
  if (error) throw error

  revalidatePath('/settings')
}
