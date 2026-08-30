'use client'

import { useFormState } from 'react-dom'

import { Alert, Field, SubmitButton } from '@/components/ui'
import type { DnsRecord } from '@/lib/vercel'
import type { Database } from '@/types/database'

import {
  checkCustomDomainAction,
  connectCustomDomainAction,
  disconnectCustomDomainAction,
  type CustomDomainFormState,
} from './actions'

type Status = Database['public']['Enums']['custom_domain_status']

const initialState: CustomDomainFormState = { error: null }

export type CustomDomainPanelProps = {
  canManage: boolean
  domain: string | null
  status: Status
  verifiedAt: string | null
  /** What Vercel says has to exist in DNS. Empty once verified, or if Vercel could not be reached. */
  records: DnsRecord[]
  /** Set when the DNS lookup against Vercel failed, so the table's absence is explained. */
  recordsError: string | null
}

export function CustomDomainPanel(props: CustomDomainPanelProps) {
  if (!props.domain) {
    return props.canManage ? <ConnectForm /> : <NoDomain />
  }
  return <ConnectedDomain {...props} domain={props.domain} />
}

function NoDomain() {
  return (
    <p className="text-sm text-slate-500">
      No custom domain connected. An admin can add one.
    </p>
  )
}

function ConnectForm() {
  const [state, formAction] = useFormState(connectCustomDomainAction, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="Domain"
        name="domain"
        required
        placeholder="help.yourcompany.com"
        hint="Your help centre will be served at the root of this domain. A subdomain is easier to set up than a root domain."
      />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <SubmitButton pendingLabel="Adding to Vercel…">Connect domain</SubmitButton>
    </form>
  )
}

function ConnectedDomain({
  canManage,
  domain,
  status,
  verifiedAt,
  records,
  recordsError,
}: CustomDomainPanelProps & { domain: string }) {
  const [checkState, checkAction] = useFormState(checkCustomDomainAction, initialState)
  const verified = status === 'verified'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{domain}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {verified && verifiedAt
              ? `Verified ${new Date(verifiedAt).toLocaleDateString()}. HTTPS is handled by Vercel automatically.`
              : 'Not serving yet. Your help centre stays available at its SuperDesk URL in the meantime.'}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {verified ? (
        <Alert tone="success">
          <a
            href={`https://${domain}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline decoration-emerald-300 underline-offset-2"
          >
            https://{domain}
          </a>{' '}
          now serves your help centre.
        </Alert>
      ) : (
        <DnsInstructions records={records} recordsError={recordsError} />
      )}

      {checkState.error ? <Alert tone="error">{checkState.error}</Alert> : null}
      {checkState.message ? <Alert tone="info">{checkState.message}</Alert> : null}

      {canManage ? (
        <div className="flex items-center gap-2">
          <form action={checkAction}>
            <SubmitButton variant="secondary" pendingLabel="Checking…">
              Check verification
            </SubmitButton>
          </form>
          <form action={disconnectCustomDomainAction}>
            <SubmitButton variant="danger" pendingLabel="Removing…">
              Disconnect
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The records come from Vercel's own response for this project rather than from
 * its published defaults, which are not always the right values — the point is
 * that an admin never has to go read Vercel's documentation to finish setup.
 */
function DnsInstructions({
  records,
  recordsError,
}: {
  records: DnsRecord[]
  recordsError: string | null
}) {
  if (recordsError) {
    return <Alert tone="error">{recordsError}</Alert>
  }
  if (records.length === 0) {
    return (
      <Alert tone="info">
        Vercel did not return any DNS records for this domain yet. Try checking verification again in
        a moment.
      </Alert>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-700">
        Add these records at your DNS provider:
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((record) => (
              <tr key={`${record.type}:${record.name}:${record.value}`} className="align-top">
                <td className="px-3 py-2 font-mono text-slate-900">{record.type}</td>
                <td className="px-3 py-2 font-mono text-slate-900">{record.name}</td>
                <td className="px-3 py-2">
                  <span className="break-all font-mono text-slate-900">{record.value}</span>
                  {record.note ? (
                    <span className="mt-0.5 block font-sans text-slate-500">{record.note}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        DNS changes can take up to an hour to propagate. Come back and check verification once
        they are in.
      </p>
    </div>
  )
}

function StatusBadge({ status }: { status: Status }) {
  const { label, className } = {
    none: { label: 'Not connected', className: 'bg-slate-100 text-slate-600' },
    pending: { label: 'Pending DNS', className: 'bg-amber-100 text-amber-800' },
    verified: { label: 'Verified', className: 'bg-emerald-100 text-emerald-800' },
    error: { label: 'Error', className: 'bg-red-100 text-red-800' },
  }[status]

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  )
}
