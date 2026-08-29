'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'

import { Alert, Field, SubmitButton } from '@/components/ui'

import { acceptInviteAction, type AcceptInviteState } from './actions'

const initialState: AcceptInviteState = { error: null }

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [state, formAction] = useFormState(acceptInviteAction, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="mode" value={mode} />

      <Field label="Email" value={email} disabled readOnly hint="Invites are tied to this address." />

      {mode === 'signup' ? (
        <>
          <Field label="Your name" name="fullName" maxLength={100} placeholder="Ada Lovelace" />
          <Field
            label="Choose a password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            hint="At least 8 characters."
          />
        </>
      ) : (
        <Field
          label="Your password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      )}

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}

      <SubmitButton pendingLabel="Joining…">
        {mode === 'signup' ? 'Create account and join' : 'Sign in and join'}
      </SubmitButton>

      <button
        type="button"
        onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
        className="block text-sm text-slate-500 underline underline-offset-4 hover:text-slate-900"
      >
        {mode === 'signup' ? 'I already have an account' : 'I need to create an account'}
      </button>
    </form>
  )
}
