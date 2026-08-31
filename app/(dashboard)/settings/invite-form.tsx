'use client'

import { useFormState } from 'react-dom'

import { Alert, Field, SubmitButton } from '@/components/ui'

import { inviteTeammateAction, type InviteFormState } from './actions'
import { CopyLink } from './copy-link'

const initialState: InviteFormState = { error: null }

export function InviteForm() {
  const [state, formAction] = useFormState(inviteTeammateAction, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="Email"
        name="email"
        type="email"
        required
        placeholder="teammate@company.com"
        hint="Teammates join as agents. Each workspace has a single admin — the person who created it."
      />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      {state.inviteUrl ? (
        <Alert tone="success">
          <p className="mb-2">
            Invite created for <strong>{state.invitedEmail}</strong>. Send them this link — it
            expires in 7 days.
          </p>
          <CopyLink url={state.inviteUrl} />
        </Alert>
      ) : null}

      <SubmitButton pendingLabel="Creating invite…">Send invite</SubmitButton>
    </form>
  )
}
