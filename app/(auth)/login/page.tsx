import Link from 'next/link'

import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · SuperDesk' }

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string }
}) {
  const next = searchParams.next?.startsWith('/') ? searchParams.next : '/inbox'

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-slate-500">Welcome back.</p>

      <LoginForm next={next} />

      <p className="mt-6 text-sm text-slate-500">
        Need a workspace?{' '}
        <Link href="/signup" className="font-medium text-slate-900 underline underline-offset-4">
          Create one
        </Link>
      </p>
    </>
  )
}
