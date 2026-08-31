'use client'

import { useFormState } from 'react-dom'

import { signInAction, type AuthFormState } from '@/app/(auth)/actions'
import { Alert, Field, SubmitButton } from '@/components/ui'

const initialState: AuthFormState = { error: null }

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useFormState(signInAction, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" required autoComplete="email" />
      <Field label="Password" name="password" type="password" required autoComplete="current-password" />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  )
}
