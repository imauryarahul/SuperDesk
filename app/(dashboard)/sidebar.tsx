'use client'

import {
  BarChart3,
  BookOpen,
  Inbox,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { signOutAction } from '@/app/(auth)/actions'
import { RoleBadge } from '@/components/ui'
import type { UserRole } from '@/lib/auth'

const NAV_ITEMS: {
  href: string
  label: string
  Icon: LucideIcon
  iconColor: string
  activeBg: string
}[] = [
  {
    href: '/inbox',
    label: 'Inbox',
    Icon: Inbox,
    iconColor: 'text-sky-600',
    activeBg: 'bg-sky-600',
  },
  {
    href: '/knowledge-base',
    label: 'Knowledge Base',
    Icon: BookOpen,
    iconColor: 'text-violet-600',
    activeBg: 'bg-violet-600',
  },
  {
    href: '/analytics',
    label: 'Analytics',
    Icon: BarChart3,
    iconColor: 'text-amber-600',
    activeBg: 'bg-amber-600',
  },
  {
    href: '/settings',
    label: 'Settings',
    Icon: Settings,
    iconColor: 'text-slate-600',
    activeBg: 'bg-slate-700',
  },
]

const STORAGE_KEY = 'superdesk-sidebar-collapsed'

function NavTooltip({ label, show }: { label: string; show: boolean }) {
  if (!show) return null

  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
    >
      {label}
    </span>
  )
}

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
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') setCollapsed(true)
  }, [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }

  const workspaceInitial = workspaceName.trim().charAt(0).toUpperCase() || 'W'
  const userInitial = displayName.trim().charAt(0).toUpperCase() || '?'

  return (
    <aside
      className={`relative flex h-full shrink-0 flex-col overflow-visible border-r border-slate-200 bg-white transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div
        className={`border-b border-slate-200 ${
          collapsed ? 'flex items-center justify-center px-2 py-3' : 'px-4 py-4'
        }`}
      >
        {collapsed ? (
          <div className="group/workspace relative">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white"
              aria-hidden="true"
            >
              {workspaceInitial}
            </div>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover/workspace:opacity-100"
            >
              {workspaceName}
            </span>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Workspace</p>
            <p className="truncate text-sm font-semibold text-slate-900">{workspaceName}</p>
          </div>
        )}
      </div>

      <nav className={`flex-1 space-y-1 ${collapsed ? 'p-2' : 'p-3'}`}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          const { Icon } = item

          return (
            <div key={item.href} className="group relative">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? undefined : item.label}
                className={`flex items-center rounded-lg text-sm font-medium transition ${
                  collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2'
                } ${
                  active
                    ? `${item.activeBg} text-white shadow-sm`
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon
                  className={`h-5 w-5 shrink-0 ${active ? 'text-white' : item.iconColor}`}
                  strokeWidth={2}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
              <NavTooltip label={item.label} show={collapsed} />
            </div>
          )
        })}
      </nav>

      <div className={`mt-auto border-t border-slate-200 ${collapsed ? 'p-2' : 'p-3'}`}>
        <div className={collapsed ? 'mb-2' : 'mb-3'}>
          {collapsed ? (
            <div className="group relative">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Expand sidebar"
                className="flex w-full items-center justify-center rounded-lg p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
              >
                <PanelLeftOpen className="h-5 w-5 shrink-0" strokeWidth={2} />
              </button>
              <NavTooltip label="Expand sidebar" show />
            </div>
          ) : (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
            >
              <PanelLeftClose className="h-5 w-5 shrink-0" strokeWidth={2} />
              Collapse sidebar
            </button>
          )}
        </div>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-700"
              title={displayName}
            >
              {userInitial}
            </div>
            <form action={signOutAction} className="w-full">
              <button
                type="submit"
                aria-label="Sign out"
                className="group/signout relative flex w-full items-center justify-center rounded-lg p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <LogOut className="h-5 w-5 shrink-0 text-red-500" strokeWidth={2} />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover/signout:opacity-100"
                >
                  Sign out
                </span>
              </button>
            </form>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </aside>
  )
}
