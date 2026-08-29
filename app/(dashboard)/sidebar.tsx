'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { signOutAction } from '@/app/(auth)/actions'
import { RoleBadge } from '@/components/ui'
import type { UserRole } from '@/lib/auth'

const NAV_ITEMS = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/knowledge-base', label: 'Knowledge Base' },
  { href: '/settings', label: 'Settings' },
]

export function Sidebar({
  workspaceName,
  displayName,
  role,
}: {
  workspaceName: string
  displayName: string
  role: UserRole
}) {
  const pathname = usePathname()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Workspace</p>
        <p className="truncate text-sm font-semibold text-slate-900">{workspaceName}</p>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <span className="truncate text-sm text-slate-700">{displayName}</span>
          <RoleBadge role={role} />
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
