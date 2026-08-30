import Link from 'next/link'
import type { ReactNode } from 'react'

import type { PublicWorkspace } from '@/lib/kb-public'

/**
 * The public help centre sits outside the (dashboard) route group on purpose:
 * no sidebar, no auth check, no Supabase session. It renders identically for a
 * signed-in agent and a stranger, which is the only way to be confident that
 * what you see while testing is what a visitor sees.
 */
export function KbShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-6 py-14">{children}</div>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        Powered by SuperDesk
      </footer>
    </div>
  )
}

export function KbHeader({
  workspace,
  breadcrumb,
}: {
  workspace: PublicWorkspace
  breadcrumb?: string
}) {
  return (
    <header>
      <Link
        href={`/kb/${workspace.slug}`}
        className="text-sm font-semibold tracking-tight text-slate-900"
      >
        {workspace.name}
      </Link>
      {breadcrumb ? (
        <p className="mt-6 text-xs uppercase tracking-wide text-slate-400">{breadcrumb}</p>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">
            How can we help?
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Search the help centre or browse by category.
          </p>
        </>
      )}
    </header>
  )
}
