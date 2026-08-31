'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import {
  MIN_MESSAGES_FOR_SUMMARY,
  isSummaryStale,
  shouldGenerateSummary,
} from '@/lib/ai-summary-policy'

type Payload = {
  summary: string | null
  summarizedInboundCount: number
  generating: boolean
}

function parsePayload(value: unknown): Payload | null {
  if (typeof value !== 'object' || value === null || !('summary' in value)) return null
  const record = value as Record<string, unknown>
  const summary = record.summary
  if (summary !== null && typeof summary !== 'string') return null
  return {
    summary,
    summarizedInboundCount:
      typeof record.summarizedInboundCount === 'number' ? record.summarizedInboundCount : 0,
    generating: record.generating === true,
  }
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

/**
 * Renders the cached summary that arrived with the conversation row, and calls
 * the model only when the thread has moved on far enough to justify it — judged
 * once per open, plus whenever the agent asks. Nothing here is on a timer: a new
 * customer message surfaces as a Refresh button rather than a silent
 * regeneration, and an agent's own reply changes nothing.
 */
export function SummaryPanel({
  conversationId,
  cachedSummary,
  summarizedInboundCount,
  messageCount,
  inboundCount,
}: {
  conversationId: string
  cachedSummary: string | null
  summarizedInboundCount: number
  messageCount: number
  inboundCount: number
}) {
  const gradientId = useId().replace(/:/g, '')
  const [result, setResult] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Conversation whose on-open decision has already been made. */
  const decidedForRef = useRef<string | null>(null)

  // A fetch supersedes the row we were handed, unless realtime has since
  // delivered a summary covering at least as much of the thread.
  const useFetched =
    result !== null && result.summarizedInboundCount >= summarizedInboundCount
  const summary = useFetched ? result.summary : cachedSummary
  const coveredInbound = useFetched ? result.summarizedInboundCount : summarizedInboundCount

  const state = {
    hasSummary: Boolean(summary),
    messageCount,
    inboundCount,
    summarizedInboundCount: coveredInbound,
  }
  const stale = isSummaryStale(state)
  const tooShort = !summary && messageCount < MIN_MESSAGES_FOR_SUMMARY

  const generate = useCallback(
    async (force: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setFailed(false)

      try {
        const res = await fetch('/api/inbox/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, force }),
          signal: controller.signal,
        })
        const data = parsePayload(await res.json().catch(() => null))
        if (controller.signal.aborted) return

        if (!res.ok || !data) {
          setFailed(true)
          setLoading(false)
          return
        }

        setResult(data)
        setLoading(false)

        // Another request holds the generation claim. Check back once rather
        // than leaving the agent with a permanently empty panel.
        if (data.generating && !data.summary) {
          retryTimerRef.current = setTimeout(() => void generate(force), 6000)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setFailed(true)
        setLoading(false)
      }
    },
    [conversationId],
  )

  // Switching threads drops anything fetched for the previous one, so the
  // outgoing summary cannot flash while the new thread's messages load.
  useEffect(() => {
    setResult(null)
    setLoading(false)
    setFailed(false)
    return () => {
      abortRef.current?.abort()
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [conversationId])

  // The only automatic trigger: the first render of this conversation that has
  // its messages loaded. Later message arrivals deliberately do not re-run it,
  // which is what the decidedForRef guard buys us despite the count deps.
  useEffect(() => {
    if (decidedForRef.current === conversationId) return
    if (messageCount === 0) return

    decidedForRef.current = conversationId
    if (
      shouldGenerateSummary({
        hasSummary: Boolean(cachedSummary),
        messageCount,
        inboundCount,
        summarizedInboundCount,
      })
    ) {
      void generate(false)
    }
  }, [
    conversationId,
    messageCount,
    inboundCount,
    cachedSummary,
    summarizedInboundCount,
    generate,
  ])

  const bullets = summary ? parseBulletPoints(summary) : []
  const showSkeleton = loading && !summary

  return (
    <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <AiSparkleIcon className="h-4 w-4 shrink-0" gradientId={gradientId} />
          <h2 className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-sky-600 bg-clip-text text-sm font-semibold text-transparent">
            Issue summary
          </h2>
          {loading && summary && <span className="text-xs text-slate-400">Updating…</span>}
        </div>
        {(failed || (stale && !loading)) && (
          <button
            type="button"
            onClick={() => void generate(true)}
            className="text-xs font-medium text-violet-600 underline-offset-2 hover:underline"
          >
            {failed ? 'Retry' : 'Refresh'}
          </button>
        )}
      </div>

      {showSkeleton && (
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

      {!showSkeleton && tooShort && !failed && (
        <p className="mt-1.5 text-sm text-slate-400">
          Summary appears once the thread has a few messages.
        </p>
      )}

      {!showSkeleton && failed && !summary && (
        <p className="mt-1.5 text-sm text-slate-500" role="status">
          Summary unavailable
        </p>
      )}

      {bullets.length > 0 && (
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
