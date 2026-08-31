import { Alert, RoleBadge } from '@/components/ui'
import { requireWorkspace } from '@/lib/auth'
import { appUrl, isVercelConfigured } from '@/lib/env'
import { inboundAddressFor } from '@/lib/postmark'
import { createClient } from '@/lib/supabase/server'
import { dnsRecordsFor, getDomainConfig, getProjectDomain, type DnsRecord } from '@/lib/vercel'

import { revokeInviteAction } from './actions'
import { AllowedDomainsPanel } from './allowed-domains'
import { CopyLink, CopySnippet } from './copy-link'
import { CustomDomainPanel } from './custom-domain'
import { InviteForm } from './invite-form'
import { RemoveMemberButton } from './remove-member-button'
import { SlaSettingsPanel } from './sla-settings'

export const metadata = { title: 'Settings · SuperDesk' }

export default async function SettingsPage() {
  const { profile, workspace } = await requireWorkspace()
  const isAdmin = profile.role === 'admin'

  return (
    <div className="flex-1 overflow-y-auto px-10 py-10">
      <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">Workspace and team.</p>

      <div className="mt-6 space-y-6">
        <Card title="Workspace">
          <dl className="text-sm">
            <dt className="text-slate-500">Name</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{workspace.name}</dd>
          </dl>
        </Card>

        <Card title="Email address">
          <InboundAddress />
        </Card>

        <Card title="Chat widget">
          <WidgetEmbed workspaceId={workspace.id} canManage={isAdmin} />
        </Card>

        <Card title="SLA and business hours">
          <SlaSettings canManage={isAdmin} />
        </Card>

        <Card title="Custom domain">
          <CustomDomain canManage={isAdmin} />
        </Card>

        <Card title="Team">
          <TeamList currentProfileId={profile.id} canManage={isAdmin} />
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
      </div>
    </div>
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

/**
 * The workspace's inbound address. Anything sent here becomes an email
 * conversation in the inbox, and it is the Reply-To on every outbound reply.
 */
async function InboundAddress() {
  const { data, error } = await createClient()
    .from('workspaces')
    .select('inbound_token')
    .maybeSingle()

  if (error || !data) {
    return <Alert tone="error">Could not load your inbound address.</Alert>
  }

  let address: string
  try {
    address = inboundAddressFor(data.inbound_token)
  } catch {
    return (
      <Alert tone="error">
        Email is not configured on this deployment. Set POSTMARK_INBOUND_ADDRESS.
      </Alert>
    )
  }

  return (
    <div className="space-y-2">
      <CopyLink url={address} />
      <p className="text-xs text-slate-500">
        Email this address, or forward your support inbox to it, and the thread appears in your
        inbox. Replies you send from the inbox come from this address too.
      </p>
    </div>
  )
}

async function WidgetEmbed({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const snippet = `<script\n  src="${appUrl()}/widget.js"\n  data-workspace-id="${workspaceId}"\n></script>`

  const { data, error } = await createClient()
    .from('workspaces')
    .select('allowed_widget_domains')
    .eq('id', workspaceId)
    .single()

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <CopySnippet text={snippet} />
        <p className="text-xs text-slate-500">
          Paste before <code className="rounded bg-slate-100 px-1">&lt;/body&gt;</code> on any site.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-700">Allowed domains</p>
        {error ? (
          <Alert tone="error">Could not load allowed domains.</Alert>
        ) : (
          <AllowedDomainsPanel canManage={canManage} domains={data.allowed_widget_domains} />
        )}
      </div>
    </div>
  )
}

/**
 * Agents see these values read-only. The numbers drive the badges in their
 * inbox, so hiding them entirely would leave the badge unexplained; only
 * changing them is admin-only, enforced by the RLS policy on workspaces rather
 * than by this component.
 */
async function SlaSettings({ canManage }: { canManage: boolean }) {
  const { data, error } = await createClient()
    .from('workspaces')
    .select(
      'first_response_target_minutes, resolution_target_minutes, business_hours_start, business_hours_end, business_days, business_timezone',
    )
    .maybeSingle()

  if (error || !data) {
    return <Alert tone="error">Could not load your SLA settings.</Alert>
  }

  return (
    <SlaSettingsPanel
      canManage={canManage}
      settings={{
        firstResponseTargetMinutes: data.first_response_target_minutes,
        resolutionTargetMinutes: data.resolution_target_minutes,
        businessHoursStart: data.business_hours_start,
        businessHoursEnd: data.business_hours_end,
        businessDays: data.business_days,
        businessTimezone: data.business_timezone,
      }}
    />
  )
}

/**
 * The DNS records are fetched from Vercel here rather than being carried around
 * in form state, so a reload shows the live answer instead of whatever the last
 * submit happened to return. Only while a domain exists and is not yet verified
 * — a verified domain needs no instructions, and no domain needs no call.
 */
async function CustomDomain({ canManage }: { canManage: boolean }) {
  const { data, error } = await createClient()
    .from('workspaces')
    .select('custom_domain, custom_domain_status, custom_domain_verified_at')
    .maybeSingle()

  if (error || !data) {
    return <Alert tone="error">Could not load your custom domain settings.</Alert>
  }

  if (!isVercelConfigured()) {
    return (
      <Alert tone="info">
        Custom domains are not configured on this deployment. Set VERCEL_API_TOKEN and
        VERCEL_PROJECT_ID (plus VERCEL_TEAM_ID if the project sits under a Vercel team).
      </Alert>
    )
  }

  let records: DnsRecord[] = []
  let recordsError: string | null = null

  if (data.custom_domain && data.custom_domain_status !== 'verified') {
    try {
      const projectDomain = await getProjectDomain(data.custom_domain)
      if (projectDomain) {
        records = dnsRecordsFor(projectDomain, await getDomainConfig(data.custom_domain))
      } else {
        recordsError = `${data.custom_domain} is not attached to this Vercel project. Disconnect it and add it again.`
      }
    } catch (lookupError) {
      // A settings page that fails to render because Vercel is slow is worse
      // than one that renders without the DNS table.
      console.error('[custom-domain] could not load DNS records:', lookupError)
      recordsError = 'Could not reach Vercel to load the DNS records. Try reloading.'
    }
  }

  return (
    <CustomDomainPanel
      canManage={canManage}
      domain={data.custom_domain}
      status={data.custom_domain_status}
      verifiedAt={data.custom_domain_verified_at}
      records={records}
      recordsError={recordsError}
    />
  )
}

async function TeamList({
  currentProfileId,
  canManage,
}: {
  currentProfileId: string
  canManage: boolean
}) {
  // RLS restricts this to the caller's workspace; no workspace_id filter needed.
  const { data, error } = await createClient()
    .from('profiles')
    .select('id, email, full_name, role')
    .order('created_at')

  if (error) return <Alert tone="error">Could not load your team: {error.message}</Alert>

  return (
    <ul className="divide-y divide-slate-100">
      {data.map((member) => {
        const isYou = member.id === currentProfileId
        const displayName = member.full_name ?? member.email
        return (
          <li
            key={member.id}
            className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {displayName}
                {isYou ? <span className="ml-2 text-xs font-normal text-slate-400">you</span> : null}
              </p>
              {member.full_name ? (
                <p className="truncate text-xs text-slate-500">{member.email}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <RoleBadge role={member.role} />
              {canManage && !isYou ? (
                <RemoveMemberButton profileId={member.id} displayName={displayName} />
              ) : null}
            </div>
          </li>
        )
      })}
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
