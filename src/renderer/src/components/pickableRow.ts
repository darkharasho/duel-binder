import type React from 'react'
import { cn } from '@/lib/utils'

/**
 * Props that make a printing row in a card side panel pick what the panel's art and price show:
 * focusable, Enter/Space to pick, aria-current on the picked row, a hover state on the others
 * and a subtle glass fill with an accent left edge on the picked one.
 */
export function pickableRow(
  picked: boolean,
  onPick: () => void,
  className?: string
): React.HTMLAttributes<HTMLDivElement> & { 'data-picked': boolean } {
  return {
    tabIndex: 0,
    'aria-current': picked ? 'true' : undefined,
    'data-picked': picked,
    className: cn(
      'cursor-pointer rounded-md border-l-2 py-1 pl-2 pr-1 outline-none transition-colors',
      'focus-visible:ring-2 focus-visible:ring-ring/60',
      picked
        ? 'border-l-primary bg-white/[0.07] ring-1 ring-inset ring-white/10'
        : 'border-l-transparent hover:bg-white/[0.04]',
      className
    ),
    onClick: onPick,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onPick()
      }
    }
  }
}
