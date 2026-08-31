'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth'
import { normalizeDomain, unclaimableDomainReason } from '@/lib/custom-domain'
import { appUrl, vercelConfig } from '@/lib/env'
import { ActionError, toFormError, type FormState } from '@/lib/forms'
import { checkRateLimit } from '@/lib/rate-limit'
import { broadcast } from '@/lib/realtime-broadcast'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  addProjectDomain,
  getDomainConfig,
  getProjectDomain,
  removeProjectDomain,
  verifyProjectDomain,
  VercelApiError,
} from '@/lib/vercel'

export type InviteFormState = FormState & { inviteUrl?: string; invitedEmail?: string }

/**
 * No role field. A workspace has exactly one admin — whoever created it — so
 * there is nothing to choose, and reading a role from the form would only
 * create a way to ask for one that cannot be granted. The database agrees:
 * workspace_invites_role_agent_only rejects any other invite, and the partial
 * unique index on profiles rejects a second admin however it is attempted.
 */
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
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
    const { email } = parsed.data

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
      role: 'agent',
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

/**
 * Drops a teammate's profile. Conversations they held become unassigned
 * (`on delete set null` on assigned_agent_id). The auth user is left in place
 * so a later invite to the same address can attach a new profile to the same
 * login rather than bouncing on "account already exists".
 *
 * Written through the caller's own client: `profiles_delete_admin` is the
 * real gate (admin, same workspace, not self). requireAdmin is the message.
 */
export async function removeTeammateAction(formData: FormData): Promise<void> {
  const { profile, workspace } = await requireAdmin()

  const profileId = z.string().uuid().safeParse(formData.get('profileId'))
  if (!profileId.success) throw new ActionError('Invalid team member.')

  if (profileId.data === profile.id) {
    throw new ActionError('You cannot remove yourself from the workspace.')
  }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', profileId.data)
    .select('id')

  if (error) throw error
  if (!data?.length) {
    throw new ActionError('That person is not on your team.')
  }

  // Open inboxes still hold this person in the assignee picker; the FK
  // unassign is visible via postgres_changes, but the agents list is
  // client state and would otherwise linger until a full reload.
  await broadcast({
    topic: `inbox:${workspace.id}`,
    event: 'agent_removed',
    payload: { profileId: profileId.data },
  })

  revalidatePath('/settings')
  revalidatePath('/inbox')
  revalidatePath('/analytics')
}

// SLA targets and business hours ---------------------------------------------

export type SlaSettingsFormState = FormState & { message?: string }

/**
 * Mirrors the CHECK constraints in migration 20260831110000 rather than
 * inventing its own limits. The constraints are the real gate — this exists so
 * an admin gets "Targets must be at least 1 minute" instead of a Postgres
 * constraint name.
 *
 * The timezone is not validated against a list here: a trigger checks it
 * against pg_timezone_names, which is the only authority that cannot go stale.
 */
const slaSettingsSchema = z
  .object({
    firstResponseTargetMinutes: z.coerce
      .number()
      .int('Use a whole number of minutes.')
      .min(1, 'First-response target must be at least 1 minute.')
      .max(86400, 'First-response target cannot exceed 60 days.'),
    resolutionTargetMinutes: z.coerce
      .number()
      .int('Use a whole number of minutes.')
      .min(1, 'Resolution target must be at least 1 minute.')
      .max(1051200, 'Resolution target cannot exceed 2 years.'),
    businessHoursStart: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Enter opening time as HH:MM.'),
    businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Enter closing time as HH:MM.'),
    businessTimezone: z.string().trim().min(1, 'Pick a timezone.').max(64),
    businessDays: z
      .array(z.coerce.number().int().min(1).max(7))
      .min(1, 'Pick at least one working day.')
      .max(7),
  })
  .refine((v) => v.businessHoursEnd > v.businessHoursStart, {
    message: 'Closing time must be after opening time. Overnight hours are not supported.',
  })

export async function updateSlaSettingsAction(
  _prevState: SlaSettingsFormState,
  formData: FormData,
): Promise<SlaSettingsFormState> {
  try {
    const { workspace } = await requireAdmin()

    const parsed = slaSettingsSchema.safeParse({
      firstResponseTargetMinutes: formData.get('firstResponseTargetMinutes'),
      resolutionTargetMinutes: formData.get('resolutionTargetMinutes'),
      businessHoursStart: formData.get('businessHoursStart'),
      businessHoursEnd: formData.get('businessHoursEnd'),
      businessTimezone: formData.get('businessTimezone'),
      // Checkboxes: absent entirely when none are ticked, which the schema
      // rejects with a real message rather than silently storing an empty week.
      businessDays: formData.getAll('businessDays'),
    })

    if (!parsed.success) {
      throw new ActionError(parsed.error.issues[0]?.message ?? 'Check the form and try again.')
    }
    const values = parsed.data

    // Written through the caller's own client, so workspaces_update_admin is
    // what authorises it — requireAdmin above is the message, not the gate.
    const { error } = await createClient()
      .from('workspaces')
      .update({
        first_response_target_minutes: values.firstResponseTargetMinutes,
        resolution_target_minutes: values.resolutionTargetMinutes,
        business_hours_start: values.businessHoursStart,
        business_hours_end: values.businessHoursEnd,
        business_timezone: values.businessTimezone,
        business_days: Array.from(new Set(values.businessDays)).sort((a, b) => a - b),
      })
      .eq('id', workspace.id)

    if (error) {
      // 22023 is what the timezone-validation trigger raises.
      if (error.code === '22023') {
        throw new ActionError(
          `${values.businessTimezone} is not a timezone Postgres recognises. Use an IANA name such as Asia/Kolkata.`,
        )
      }
      throw error
    }

    // Every SLA badge and the analytics breach count are derived from these
    // numbers, so both pages have to be re-rendered, not just this one.
    revalidatePath('/settings')
    revalidatePath('/inbox')
    revalidatePath('/analytics')
    return { error: null, message: 'SLA targets and business hours saved.' }
  } catch (error) {
    return toFormError(error, 'updateSlaSettingsAction')
  }
}

// Widget allowed domains ------------------------------------------------------

export type AllowedDomainsFormState = FormState & { message?: string }

const MAX_ALLOWED_DOMAINS = 20

/**
 * Must come out exactly equal to what a browser sends as the Origin header —
 * scheme, host, and port, nothing else. `new URL` is only used to validate
 * and normalise; the stored value is `url.origin`, never the raw input, so a
 * trailing slash or stray path typed into the form can't end up in the
 * allowlist that checkWidgetOrigin compares against with a plain string match.
 */
function parseWidgetOrigin(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new ActionError(
      'Enter a full URL including the scheme, e.g. https://yoursite.com.',
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ActionError('Only http:// and https:// domains are allowed.')
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new ActionError(
      'Enter just the domain, with no path — e.g. https://yoursite.com, not https://yoursite.com/page.',
    )
  }

  return url.origin
}

export async function addAllowedDomainAction(
  _prevState: AllowedDomainsFormState,
  formData: FormData,
): Promise<AllowedDomainsFormState> {
  try {
    const { workspace } = await requireAdmin()
    const origin = parseWidgetOrigin(String(formData.get('domain') ?? ''))

    const supabase = createClient()
    const current = await loadAllowedDomains(supabase, workspace.id)

    if (current.includes(origin)) {
      throw new ActionError(`${origin} is already allowed.`)
    }
    if (current.length >= MAX_ALLOWED_DOMAINS) {
      throw new ActionError(
        `You can have at most ${MAX_ALLOWED_DOMAINS} allowed domains. Remove one first.`,
      )
    }

    const { error } = await supabase
      .from('workspaces')
      .update({ allowed_widget_domains: [...current, origin] })
      .eq('id', workspace.id)

    if (error) throw error

    revalidatePath('/settings')
    return { error: null, message: `${origin} can now load the chat widget.` }
  } catch (error) {
    return toFormError(error, 'addAllowedDomainAction')
  }
}

/**
 * No confirmation step: removing a domain only stops the widget loading
 * there going forward, it does not touch any data, and re-adding it is one
 * form submit away.
 */
export async function removeAllowedDomainAction(formData: FormData): Promise<void> {
  const { workspace } = await requireAdmin()

  const origin = String(formData.get('domain') ?? '')
  if (!origin) throw new ActionError('Missing domain.')

  const supabase = createClient()
  const current = await loadAllowedDomains(supabase, workspace.id)

  const { error } = await supabase
    .from('workspaces')
    .update({ allowed_widget_domains: current.filter((d) => d !== origin) })
    .eq('id', workspace.id)

  if (error) throw error

  revalidatePath('/settings')
}

async function loadAllowedDomains(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('allowed_widget_domains')
    .eq('id', workspaceId)
    .single()

  if (error) throw error
  return data.allowed_widget_domains
}

// Custom domains -------------------------------------------------------------

export type CustomDomainFormState = FormState & { message?: string }

const domainSchema = z.string().trim().min(1, 'Enter a domain.').max(253)

/**
 * Attaches a hostname to the Vercel project and records the claim as 'pending'.
 *
 * It never records it as anything else. Verification is a separate, explicit
 * step, so nothing an admin types into this form can cause their workspace's
 * help centre to be served on a hostname they have not proven they own.
 */
export async function connectCustomDomainAction(
  _prevState: CustomDomainFormState,
  formData: FormData,
): Promise<CustomDomainFormState> {
  try {
    const { workspace } = await requireAdmin()
    assertVercelConfigured()

    const parsed = domainSchema.safeParse(formData.get('domain'))
    if (!parsed.success) {
      throw new ActionError(parsed.error.issues[0]?.message ?? 'Enter a domain.')
    }

    const domain = normalizeDomain(parsed.data)
    if (!domain) {
      throw new ActionError(
        'That does not look like a domain. Use a hostname such as help.yourcompany.com.',
      )
    }

    const reason = unclaimableDomainReason(domain, new URL(appUrl()).hostname)
    if (reason) throw new ActionError(reason)

    const current = await loadCustomDomain(workspace.id)
    if (current.custom_domain) {
      throw new ActionError(
        `${current.custom_domain} is already connected. Disconnect it first to use a different domain.`,
      )
    }

    // Each attempt costs a Vercel API call and can attach a domain to the
    // project, so it is metered per workspace rather than left unbounded.
    if (!(await checkRateLimit(workspace.id, 'domain:connect', 60, 5))) {
      throw new ActionError('Too many attempts. Wait a minute and try again.')
    }

    // Checked before touching Vercel: the unique index would catch it either
    // way, but only after we had already attached someone else's domain to the
    // project, which we would then have no safe way to undo.
    await assertDomainUnclaimed(domain)

    try {
      await addProjectDomain(domain)
    } catch (error) {
      throw asDomainActionError(error, domain)
    }

    const { error } = await createClient()
      .from('workspaces')
      .update({
        custom_domain: domain,
        custom_domain_status: 'pending',
        custom_domain_verified_at: null,
      })
      .eq('id', workspace.id)

    if (error) {
      // Leave nothing half-done: the domain is on the project but no workspace
      // claims it, which would block any later attempt to connect it properly.
      await removeProjectDomain(domain).catch((cleanupError: unknown) => {
        console.error('[custom-domain] rollback failed:', cleanupError)
      })
      throw error
    }

    revalidatePath('/settings')
    return { error: null, message: `${domain} added. Add the DNS records below, then check it.` }
  } catch (error) {
    return toFormError(error, 'connectCustomDomainAction')
  }
}

/**
 * On-demand verification. Deliberately not a background job: DNS propagation is
 * measured in minutes to hours, and an admin clicking a button is a better
 * trigger than a cron that polls every claimed domain forever.
 *
 * 'verified' requires two separate things Vercel reports, ownership *and* a
 * resolvable configuration, because a domain whose ownership checks out but
 * whose DNS does not point here has no certificate and does not work. Anything
 * short of both stays 'pending'.
 */
export async function checkCustomDomainAction(
  _prevState: CustomDomainFormState,
  _formData: FormData,
): Promise<CustomDomainFormState> {
  try {
    const { workspace } = await requireAdmin()
    assertVercelConfigured()

    const current = await loadCustomDomain(workspace.id)
    const domain = current.custom_domain
    if (!domain) throw new ActionError('No domain is connected.')

    if (!(await checkRateLimit(workspace.id, 'domain:check', 60, 20))) {
      throw new ActionError('Too many checks. Wait a minute and try again.')
    }

    let status: 'pending' | 'verified' | 'error'
    let message: string

    try {
      const attached = await getProjectDomain(domain)

      if (!attached) {
        status = 'error'
        message = `${domain} is no longer attached to this Vercel project. Disconnect it and add it again.`
      } else {
        const { domain: projectDomain, error: verifyError } = await verifyProjectDomain(domain)

        if (verifyError) {
          status = 'pending'
          message = verificationPendingMessage(verifyError)
        } else if (!projectDomain.verified) {
          status = 'pending'
          message =
            'Vercel has not verified ownership yet. Add the records below and check again.'
        } else {
          const config = await getDomainConfig(domain)
          status = config.misconfigured ? 'pending' : 'verified'
          message = config.misconfigured
            ? 'Ownership is verified, but the DNS records are not pointing here yet. This can take up to an hour to propagate.'
            : `${domain} is verified and serving your help centre. Vercel has provisioned the certificate.`
        }
      }
    } catch (error) {
      throw asDomainActionError(error, domain)
    }

    const { error } = await createClient()
      .from('workspaces')
      .update({
        custom_domain_status: status,
        // Written once, on the first success, and never cleared by a later
        // regression: "verified in the past" and "never verified" are different
        // facts when something breaks.
        ...(status === 'verified' && !current.custom_domain_verified_at
          ? { custom_domain_verified_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', workspace.id)

    if (error) throw error

    revalidatePath('/settings')
    return { error: null, message }
  } catch (error) {
    return toFormError(error, 'checkCustomDomainAction')
  }
}

export async function disconnectCustomDomainAction(): Promise<void> {
  const { workspace } = await requireAdmin()
  const current = await loadCustomDomain(workspace.id)

  // Our row first. It is what the router reads, so clearing it is what actually
  // stops the domain serving; detaching it at Vercel is housekeeping and must
  // not be able to leave the domain live because it failed.
  const { error } = await createClient()
    .from('workspaces')
    .update({
      custom_domain: null,
      custom_domain_status: 'none',
      custom_domain_verified_at: null,
    })
    .eq('id', workspace.id)

  if (error) throw error

  if (current.custom_domain) {
    await removeProjectDomain(current.custom_domain).catch((cleanupError: unknown) => {
      console.error('[custom-domain] detach from project failed:', cleanupError)
    })
  }

  revalidatePath('/settings')
}

type CustomDomainRow = {
  custom_domain: string | null
  custom_domain_verified_at: string | null
}

async function loadCustomDomain(workspaceId: string): Promise<CustomDomainRow> {
  const { data, error } = await createClient()
    .from('workspaces')
    .select('custom_domain, custom_domain_verified_at')
    .eq('id', workspaceId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new ActionError('Could not load your workspace.')
  return data
}

/**
 * custom_domain is unique, so this is also enforced by the database. Reading it
 * first, across workspaces (hence the admin client), turns a constraint
 * violation into an answer the admin can act on.
 */
async function assertDomainUnclaimed(domain: string): Promise<void> {
  const { data, error } = await createAdminClient()
    .from('workspaces')
    .select('id')
    .eq('custom_domain', domain)
    .maybeSingle()

  if (error) throw error
  if (data) {
    throw new ActionError('That domain is already connected to another SuperDesk workspace.')
  }
}

/** Missing Vercel credentials are a deployment problem; say so instead of "something went wrong". */
function assertVercelConfigured(): void {
  try {
    vercelConfig()
  } catch (error) {
    throw new ActionError(
      error instanceof Error
        ? error.message
        : 'Custom domains are not configured on this deployment.',
    )
  }
}

/**
 * Maps a Vercel failure to something an admin can act on. Anything else is
 * passed through untouched so toFormError logs it and shows the generic message.
 */
function asDomainActionError(error: unknown, domain: string): unknown {
  if (!(error instanceof VercelApiError)) return error

  console.error(`[custom-domain] vercel ${error.status}/${error.code} for ${domain}:`, error.message)

  if (error.code === 'timeout' || error.code === 'network_error') {
    return new ActionError('Vercel did not respond. Try again in a moment.')
  }
  if (error.status === 401 || error.status === 403) {
    return new ActionError(
      'Vercel rejected our API token. Check VERCEL_API_TOKEN, and VERCEL_TEAM_ID if the project sits under a team.',
    )
  }
  if (error.status === 409) {
    return new ActionError(
      `${domain} is already in use by another Vercel project or account. Remove it there first.`,
    )
  }
  if (error.status === 400) {
    return new ActionError(`Vercel rejected that domain: ${error.message}`)
  }
  return new ActionError('Vercel could not process that request. Try again.')
}

/** Turn Vercel's verify 400 text into something an admin can act on. */
function verificationPendingMessage(vercelMessage: string): string {
  const lower = vercelMessage.toLowerCase()
  if (lower.includes('txt') && lower.includes('does not match')) {
    return 'The TXT verification record is wrong or still propagating. Match the value in the table below exactly, then check again.'
  }
  if (lower.includes('does not have a txt record')) {
    return 'Vercel cannot see the TXT verification record yet. Add it from the table below — on most providers the name is just `_vercel`, not the full hostname.'
  }
  if (lower.includes('verified for another project')) {
    return 'This domain is already verified on another Vercel project. Remove it there first, or add the TXT record shown below to prove ownership here.'
  }
  return `Vercel could not verify the domain yet: ${vercelMessage}`
}
