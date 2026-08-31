'use client'

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'

const GAP = 8

/**
 * Accessible info tooltip for metric labels. Visible on hover, keyboard focus,
 * or tap (tap toggles until pointer leaves the control). Flips above/below to
 * stay within the viewport.
 */
export function InfoTooltip({ content }: { content: string }) {
  const id = useId()
  const [pinned, setPinned] = useState(false)
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current
    const tooltip = tooltipRef.current
    if (!trigger || !tooltip) return

    const triggerRect = trigger.getBoundingClientRect()
    const tooltipHeight = tooltip.offsetHeight
    const spaceAbove = triggerRect.top
    const spaceBelow = window.innerHeight - triggerRect.bottom

    if (spaceBelow >= tooltipHeight + GAP) {
      setPlacement('bottom')
    } else if (spaceAbove >= tooltipHeight + GAP) {
      setPlacement('top')
    } else {
      setPlacement(spaceBelow >= spaceAbove ? 'bottom' : 'top')
    }
  }, [])

  useLayoutEffect(() => {
    updatePlacement()
    window.addEventListener('scroll', updatePlacement, { passive: true })
    window.addEventListener('resize', updatePlacement)
    return () => {
      window.removeEventListener('scroll', updatePlacement)
      window.removeEventListener('resize', updatePlacement)
    }
  }, [content, updatePlacement])

  return (
    <span
      className="group relative inline-flex shrink-0"
      onMouseEnter={updatePlacement}
      onMouseLeave={() => setPinned(false)}
    >
      <button
        ref={triggerRef}
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
        ref={tooltipRef}
        id={id}
        role="tooltip"
        className={`absolute right-0 z-50 w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-100 shadow-lg transition-opacity ${
          placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
        } ${
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
