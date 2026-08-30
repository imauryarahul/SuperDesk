'use client'

import { useState } from 'react'

function useCopyFeedback() {
  const [copied, setCopied] = useState(false)

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return { copied, copy }
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M13.485 3.515a.75.75 0 0 1 0 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06l1.97 1.97 5.72-5.72a.75.75 0 0 1 1.06 0Z"
      />
    </svg>
  )
}

/** Compact copy control for tight layouts such as table cells. */
export function CopyIconButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopyFeedback()

  return (
    <button
      type="button"
      onClick={() => copy(text)}
      title={copied ? 'Copied' : `Copy ${label}`}
      aria-label={copied ? 'Copied' : `Copy ${label}`}
      className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <ClipboardIcon className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

export function CopyLink({ url }: { url: string }) {
  const { copied, copy } = useCopyFeedback()

  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-700"
      />
      <button
        type="button"
        onClick={() => copy(url)}
        className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function CopySnippet({ text, rows = 4 }: { text: string; rows?: number }) {
  const { copied, copy } = useCopyFeedback()

  return (
    <div className="flex gap-2">
      <textarea
        readOnly
        rows={rows}
        value={text}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 resize-y rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-700"
      />
      <button
        type="button"
        onClick={() => copy(text)}
        className="h-fit shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
