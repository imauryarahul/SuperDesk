'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'

import { ActionError, toFormError, type FormState } from '@/lib/forms'
import { checkRateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function getActionIp(): string {
  const h = headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown'
}

export type AuthFormState = FormState & { notice?: string }

const email = z.string().trim().toLowerCase().email('Enter a valid email address.')
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.')

const signUpSchema = z.object({
  workspaceName: z
    .string()
    .trim()
    .min(1, 'Workspace name is required.')
    .max(100, 'Workspace name must be at most 100 characters.'),
  fullName: z.string().trim().max(100).optional(),
  email,
  password,
})

const signInSchema = z.object({ email, password: z.string().min(1, 'Password is required.') })

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let needsEmailConfirmation = false

  try {
    // 5 signup attempts per IP per 5 minutes prevents mass account creation.
    const allowed = await checkRateLimit(getActionIp(), 'auth:signup', 300, 5)
    if (!allowed) throw new ActionError('Too many signup attempts. Wait a few minutes and try again.')

    const input = parse(signUpSchema, formData)
    const supabase = createClient()

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { full_name: input.fullName ?? null } },
    })

    if (error) throw new ActionError(describeAuthError(error.code, error.message))
    if (!data.user) throw new ActionError('Could not create your account. Please try again.')

    // Supabase returns a decoy user with no identities rather than confirming
    // that an address is taken. Treat that as "already registered".
    if (data.user.identities?.length === 0) {
      throw new ActionError('An account with this email already exists. Sign in instead.')
    }

    await createWorkspaceForNewUser(data.user.id, input)

    needsEmailConfirmation = data.session === null
  } catch (error) {
    return toFormError(error, 'signUpAction')
  }

  if (needsEmailConfirmation) {
    return {
      error: null,
      notice: 'Workspace created. Check your inbox to confirm your email, then sign in.',
    }
  }
  redirect('/inbox')
}

/**
 * The RPC creates the workspace and the admin profile in one statement. If it
 * fails we roll the auth user back, otherwise the address is burnt: the person
 * could neither sign up again nor reach a workspace.
 */
async function createWorkspaceForNewUser(
  authUserId: string,
  input: z.infer<typeof signUpSchema>,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.rpc('create_workspace_with_admin', {
    p_auth_user_id: authUserId,
    p_email: input.email,
    p_workspace_name: input.workspaceName,
    p_full_name: input.fullName ?? undefined,
  })

  if (!error) return

  if (error.message.includes('profile_already_exists')) {
    throw new ActionError('This account already belongs to a workspace. Sign in instead.')
  }

  await admin.auth.admin.deleteUser(authUserId)
  throw error
}

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let destination: string

  try {
    // 20 login attempts per IP per minute is generous for humans, tight for bots.
    const allowed = await checkRateLimit(getActionIp(), 'auth:signin', 60, 20)
    if (!allowed) throw new ActionError('Too many login attempts. Wait a minute and try again.')

    const input = parse(signInSchema, formData)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithPassword(input)
    if (error) throw new ActionError(describeAuthError(error.code, 'Incorrect email or password.'))

    destination = safeRedirectTarget(formData.get('next'))
  } catch (error) {
    return toFormError(error, 'signInAction')
  }

  redirect(destination)
}

export async function signOutAction(): Promise<void> {
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

function parse<T extends z.ZodTypeAny>(schema: T, formData: FormData): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(formData))
  if (!result.success) {
    throw new ActionError(result.error.issues[0]?.message ?? 'Please check the form and try again.')
  }
  return result.data
}

/** Never redirect to an absolute URL supplied by the caller. */
function safeRedirectTarget(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/inbox'
}

function describeAuthError(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Sign in instead.'
    case 'weak_password':
      return 'That password is too weak. Try a longer one.'
    case 'email_address_invalid':
      // Supabase rejects reserved TLDs such as .local and .test outright.
      return 'Supabase rejected that email address. Use a real, deliverable domain.'
    case 'email_not_confirmed':
      return 'Confirm your email address before signing in.'
    case 'invalid_credentials':
      return 'Incorrect email or password.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.'
    default:
      return fallback
  }
}
