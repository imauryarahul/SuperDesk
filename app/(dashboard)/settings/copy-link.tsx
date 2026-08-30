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
