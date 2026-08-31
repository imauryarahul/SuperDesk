'use client'

import { useFormState } from 'react-dom'

import { Alert, SubmitButton } from '@/components/ui'

import {
  addAllowedDomainAction,
  removeAllowedDomainAction,
  type AllowedDomainsFormState,
} from './actions'

const initialState: AllowedDomainsFormState = { error: null }

export function AllowedDomainsPanel({
  canManage,
  domains,
}: {
  canManage: boolean
  domains: string[]
}) {
  const [state, formAction] = useFormState(addAllowedDomainAction, initialState)

  return (
    <div className="space-y-3">
      {domains.length === 0 ? (
        <p className="text-sm text-slate-500">
          No domains allowed yet — the widget will not load anywhere until you add one below.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {domains.map((domain) => (
            <li
              key={domain}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
            >
              <span className="truncate font-mono text-xs text-slate-700">{domain}</span>
              {canManage ? (
                <form action={removeAllowedDomainAction}>
                  <input type="hidden" name="domain" value={domain} />
                  <button
                    type="submit"
                    className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form action={formAction} className="flex items-start gap-2">
          <input
            type="text"
            name="domain"
            placeholder="https://yoursite.com"
            required
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
          <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
        </form>
      ) : null}

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <p className="text-xs text-slate-500">
        Only sites listed here can load and use the chat widget. Include the scheme exactly —{' '}
        <code className="rounded bg-slate-100 px-1">https://yoursite.com</code> and{' '}
        <code className="rounded bg-slate-100 px-1">http://yoursite.com</code> are different
        origins.
      </p>
    </div>
  )
}
