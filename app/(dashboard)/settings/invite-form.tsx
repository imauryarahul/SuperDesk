'use client'

import { useFormState } from 'react-dom'

import { Alert, Field, SelectField, SubmitButton } from '@/components/ui'

import { inviteTeammateAction, type InviteFormState } from './actions'
import { CopyLink } from './copy-link'

const initialState: InviteFormState = { error: null }

export function InviteForm() {
  const [state, formAction] = useFormState(inviteTeammateAction, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label="Email" name="email" type="email" required placeholder="teammate@company.com" />
        <SelectField label="Role" name="role" defaultValue="agent">
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </SelectField>
      </div>

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
