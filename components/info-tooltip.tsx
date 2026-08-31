'use client'

import { useId, useState } from 'react'

/**
 * Accessible info tooltip for metric labels. Visible on hover, keyboard focus,
 * or tap (tap toggles until pointer leaves the control).
 */
export function InfoTooltip({ content }: { content: string }) {
  const id = useId()
  const [pinned, setPinned] = useState(false)

  return (
    <span
      className="group relative inline-flex shrink-0"
      onMouseLeave={() => setPinned(false)}
    >
      <button
        type="button"
        aria-describedby={id}
        className="rounded-full p-0.5 text-slate-400 transition hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
        onClick={() => setPinned((open) => !open)}
      >
        <span aria-hidden className="block text-xs leading-none">
          ⓘ
        </span>
        <span className="sr-only">More information</span>
      </button>
      <span
        id={id}
        role="tooltip"
        className={`absolute bottom-full right-0 z-50 mb-2 w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-600 shadow-lg transition-opacity ${
          pinned
            ? 'visible opacity-100'
            : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'
        }`}
      >
        {content}
      </span>
    </span>
  )
}
