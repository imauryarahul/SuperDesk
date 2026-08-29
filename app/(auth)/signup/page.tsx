import Link from 'next/link'

import { SignUpForm } from './signup-form'

export const metadata = { title: 'Create a workspace · SuperDesk' }

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mb-6 mt-1 text-sm text-slate-500">You&apos;ll be its first admin.</p>

      <SignUpForm />

      <p className="mt-6 text-sm text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-slate-900 underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </>
  )
}
