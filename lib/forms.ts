export type FormState = { error: string | null }

export const idleFormState: FormState = { error: null }

/** An error whose message is safe to render to the user. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionError'
  }
}

/**
 * Server actions must never leak a stack trace or a raw Postgres message to the
 * browser, but silently swallowing a failure is worse. Anything we raised on
 * purpose is shown verbatim; everything else is logged and reported generically.
 */
export function toFormError(error: unknown, context: string): FormState {
  console.error(`[${context}]`, error)
  if (error instanceof ActionError) {
    return { error: error.message }
  }
  return { error: 'Something went wrong on our side. Please try again.' }
}
