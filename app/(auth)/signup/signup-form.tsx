'use client'

import { useFormState } from 'react-dom'

import { signUpAction, type AuthFormState } from '@/app/(auth)/actions'
import { Alert, Field, SubmitButton } from '@/components/ui'

const initialState: AuthFormState = { error: null }

export function SignUpForm() {
  const [state, formAction] = useFormState(signUpAction, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Workspace name" name="workspaceName" required maxLength={100} placeholder="Acme Support" />
      <Field label="Your name" name="fullName" maxLength={100} placeholder="Ada Lovelace" />
      <Field label="Work email" name="email" type="email" required autoComplete="email" />
      <Field
        label="Password"
        name="password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        hint="At least 8 characters."
      />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}

      <SubmitButton pendingLabel="Creating workspace…">Create workspace</SubmitButton>
    </form>
  )
}
