'use client'

import { useState } from 'react'

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied; the input below is selectable anyway.
      setCopied(false)
    }
  }

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
        onClick={copy}
        className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
