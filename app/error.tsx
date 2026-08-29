'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-slate-600">{error.message}</p>
        {error.digest ? (
          <p className="font-mono text-xs text-slate-400">Reference: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
