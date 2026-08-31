import Image from 'next/image'
import Link from 'next/link'
import { BarChart3, BookOpenText, Globe2, Inbox, MessageSquareText, Sparkles } from 'lucide-react'

import { LoginForm } from './login-form'

export const metadata = { title: 'SuperDesk · Customer support, unified' }

const features = [
  {
    icon: Inbox,
    title: 'Unified inbox',
    description: 'Chat and email in one queue, with assignment, snoozing, and SLA tracking built in.',
  },
  {
    icon: MessageSquareText,
    title: 'Live chat widget',
    description: 'A single script tag adds real-time chat, typing indicators, and read receipts to any site.',
  },
  {
    icon: Sparkles,
    title: 'AI-assisted replies',
    description: 'Every conversation gets a live summary, plus drafted replies grounded in your knowledge base.',
  },
  {
    icon: BookOpenText,
    title: 'Knowledge base',
    description: 'A searchable help centre your customers can use, and your widget can suggest from automatically.',
  },
]

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string }
}) {
  const next = searchParams.next?.startsWith('/') ? searchParams.next : '/inbox'

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden px-12 py-12 text-slate-800 lg:flex" style={{ background: 'linear-gradient(135deg, #e8f4fd 0%, #dbeeff 40%, #c7e2f9 70%, #d4eafa 100%)' }}>
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 15% 15%, rgba(59,130,246,0.12), transparent 45%), radial-gradient(circle at 85% 75%, rgba(99,179,237,0.10), transparent 50%)',
          }}
        />

        <div className="relative">
          <Image src="/logo.png" alt="SuperDesk" width={180} height={48} className="h-10 w-auto" priority />
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-900">
            One place for every customer conversation.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Chat, email, and a knowledge base — with AI summaries and SLA tracking so nothing falls
            through the cracks.
          </p>

          <ul className="mt-9 space-y-5">
            {features.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-900">{title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-slate-500">
          <Globe2 className="h-3.5 w-3.5" aria-hidden />
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          <span>Custom domains &amp; analytics, included.</span>
        </div>
      </section>

      <section className="flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 block lg:hidden">
            <Image src="/logo.png" alt="SuperDesk" width={160} height={42} className="h-9 w-auto" priority />
          </Link>

          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
            <p className="mb-6 mt-1 text-sm text-slate-500">Welcome back.</p>

            <LoginForm next={next} />

            <p className="mt-6 text-sm text-slate-500">
              Need a workspace?{' '}
              <Link href="/signup" className="font-medium text-slate-900 underline underline-offset-4">
                Create one
              </Link>
            </p>
          </div>

          <ul className="mt-8 grid grid-cols-2 gap-4 lg:hidden">
            {features.map(({ icon: Icon, title }) => (
              <li key={title} className="flex items-center gap-2 text-sm text-slate-600">
                <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                {title}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  )
}
