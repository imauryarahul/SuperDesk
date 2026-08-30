'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

type Status = 'loading' | 'ready' | 'empty' | 'unavailable'

function isSummaryPayload(
  value: unknown,
): value is { summary: string | null; messageCount?: number } {
  if (typeof value !== 'object' || value === null || !('summary' in value)) return false
  const summary = (value as { summary: unknown }).summary
  return summary === null || typeof summary === 'string'
}

/** Normalise model output (or legacy plain-text summaries) into bullet strings. */
function parseBulletPoints(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ''))
    .filter(Boolean)
}

function AiSparkleIcon({ className, gradientId }: { className?: string; gradientId: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="50%" stopColor="#d946ef" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M10 1.5 11.4 7.1 17 8.5 11.4 9.9 10 15.5 8.6 9.9 3 8.5 8.6 7.1 10 1.5Z"
      />
      <path
        fill={`url(#${gradientId})`}
        d="M16.5 2.5 17.1 4.6 19.2 5.2 17.1 5.8 16.5 7.9 15.9 5.8 13.8 5.2 15.9 4.6 16.5 2.5Z"
      />
      <path
        fill={`url(#${gradientId})`}
        d="M4.5 11.5 5.1 13.6 7.2 14.2 5.1 14.8 4.5 16.9 3.9 14.8 1.8 14.2 3.9 13.6 4.5 11.5Z"
      />
    </svg>
  )
}

export function SummaryPanel({
  conversationId,
  messageCount,
}: {
  conversationId: string
  messageCount: number
}) {
  const gradientId = useId().replace(/:/g, '')
  const [status, setStatus] = useState<Status>('loading')
  const [summary, setSummary] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const summarizedCountRef = useRef(0)
  const summaryRef = useRef<string | null>(null)
  const messageCountRef = useRef(messageCount)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messageCountRef.current = messageCount
  }, [messageCount])

  const load = useCallback(async (mode: 'open' | 'refresh' | 'retry') => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (mode === 'open') {
      setStatus('loading')
      setSummary(null)
      summaryRef.current = null
      setRefreshing(false)
    } else if (mode === 'retry') {
      setStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'))
      setRefreshing(true)
    } else {
      setRefreshing(true)
    }

    try {
      const res = await fetch('/api/inbox/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
        signal: controller.signal,
      })
      const data: unknown = await res.json().catch(() => null)
      if (controller.signal.aborted) return

      if (!res.ok || !isSummaryPayload(data)) {
        if (summaryRef.current) {
          setRefreshing(false)
          return
        }
        setStatus('unavailable')
        setRefreshing(false)
        return
      }

      if (data.summary === null) {
        setSummary(null)
        summaryRef.current = null
        setStatus('empty')
        summarizedCountRef.current = data.messageCount ?? 0
      } else {
        setSummary(data.summary)
        summaryRef.current = data.summary
        setStatus('ready')
        summarizedCountRef.current = data.messageCount ?? messageCountRef.current
      }
      setRefreshing(false)
    } catch (err) {
      if (controller.signal.aborted) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (summaryRef.current) {
        setRefreshing(false)
        return
      }
      setStatus('unavailable')
      setRefreshing(false)
    }
  }, [conversationId])

  useEffect(() => {
    summarizedCountRef.current = 0
    void load('open')
    return () => {
      abortRef.current?.abort()
    }
  }, [load])

  useEffect(() => {
    if (status !== 'ready' && status !== 'empty') return
    if (messageCount <= summarizedCountRef.current) return
    const timer = setTimeout(() => {
      void load(status === 'empty' ? 'open' : 'refresh')
    }, 4000)
    return () => clearTimeout(timer)
  }, [messageCount, status, load])

  const bullets = summary ? parseBulletPoints(summary) : []

  return (
    <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <AiSparkleIcon className="h-4 w-4 shrink-0" gradientId={gradientId} />
          <h2 className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-sky-600 bg-clip-text text-sm font-semibold text-transparent">
            Issue summary
          </h2>
          {refreshing && status === 'ready' && (
            <span className="text-xs text-slate-400">Updating…</span>
          )}
        </div>
        {status === 'unavailable' && (
          <button
            type="button"
            onClick={() => void load('retry')}
            className="text-xs font-medium text-violet-600 underline-offset-2 hover:underline"
          >
            Retry
          </button>
        )}
      </div>

      {status === 'loading' && (
        <ul className="mt-2 space-y-1" aria-live="polite" aria-label="Generating summary">
          {[0.85, 0.65, 0.75].map((width) => (
            <li key={width} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 animate-pulse rounded-full bg-violet-300" />
              <span
                className="h-2.5 animate-pulse rounded bg-slate-200"
                style={{ width: `${width * 100}%` }}
              />
            </li>
          ))}
        </ul>
      )}

      {status === 'empty' && (
        <p className="mt-1.5 text-sm text-slate-400">
          Summary will appear once there are messages.
        </p>
      )}

      {status === 'unavailable' && (
        <p className="mt-1.5 text-sm text-slate-500" role="status">
          Summary unavailable
        </p>
      )}

      {status === 'ready' && bullets.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {bullets.map((point, i) => (
            <li key={i} className="flex gap-2 text-sm leading-snug text-slate-700">
              <span
                className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gradient-to-br from-violet-400 to-sky-400"
                aria-hidden="true"
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
