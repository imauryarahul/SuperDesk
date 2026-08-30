'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Status = 'loading' | 'ready' | 'empty' | 'unavailable'

function isSummaryPayload(
  value: unknown,
): value is { summary: string | null; messageCount?: number } {
  if (typeof value !== 'object' || value === null || !('summary' in value)) return false
  const summary = (value as { summary: unknown }).summary
  return summary === null || typeof summary === 'string'
}

export function SummaryPanel({
  conversationId,
  messageCount,
}: {
  conversationId: string
  messageCount: number
}) {
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
        // Keep a previously-good summary if a refresh fails.
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

  // New messages while this thread is open: wait a beat, then (re)generate.
  // 'empty' is included so a conversation that had no messages when the panel
  // mounted still gets summarised once the first one arrives — otherwise it
  // would sit on "Summary will appear once there are messages" forever, since
  // the retry button only appears for 'unavailable'. Failures here must not
  // retry themselves.
  useEffect(() => {
    if (status !== 'ready' && status !== 'empty') return
    if (messageCount <= summarizedCountRef.current) return
    const timer = setTimeout(() => {
      void load(status === 'empty' ? 'open' : 'refresh')
    }, 4000)
    return () => clearTimeout(timer)
  }, [messageCount, status, load])

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Issue summary
            {refreshing && status === 'ready' && (
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                Updating…
              </span>
            )}
          </p>
          {status === 'unavailable' && (
            <button
              type="button"
              onClick={() => void load('retry')}
              className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
            >
              Retry
            </button>
          )}
        </div>

        {status === 'loading' && (
          <div className="mt-2 space-y-1.5" aria-live="polite" aria-label="Generating summary">
            <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
          </div>
        )}

        {status === 'empty' && (
          <p className="mt-1.5 text-sm text-slate-400">Summary will appear once there are messages.</p>
        )}

        {status === 'unavailable' && (
          <p className="mt-1.5 text-sm text-slate-500" role="status">
            Summary unavailable
          </p>
        )}

        {status === 'ready' && summary && (
          <p className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {summary}
          </p>
        )}
      </div>
    </div>
  )
}
