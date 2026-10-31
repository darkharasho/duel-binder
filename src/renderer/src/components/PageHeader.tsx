import { useLayoutEffect, useRef } from 'react'
import { useGame } from '@/lib/game'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { GameChip } from './GameSwitch'

/**
 * A page's title bar, pinned to the top of the scrolling main area. Sits first in a `p-8` page
 * (`max-md:p-4` under 768 px). On the phone it scrolls away under the shell's sticky status line,
 * and carries the game chip at its right when the account has more than one game.
 */
export function PageHeader({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { available } = useGame()
  const chip = isPhone() && available.length > 1
  // Tells the main scroll area how tall the header is, so its scrollbar gutter can match the glass.
  useLayoutEffect(() => {
    const el = ref.current
    const main = el?.closest<HTMLElement>('main[data-main-scroll]')
    if (!el || !main) return
    const update = (): void => {
      // Sets keeps its list's header mounted, hidden, under an open set: that one measures nothing.
      if (el.offsetHeight > 0) main.style.setProperty('--page-header-h', `${el.offsetHeight}px`)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    return () => {
      observer?.disconnect()
      main.style.removeProperty('--page-header-h')
    }
  }, [])
  return (
    <div
      ref={ref}
      data-page-header
      className={cn(
        'sticky top-0 z-20 -mx-8 -mt-8 space-y-3 border-b border-white/[0.06] bg-background/60 px-8 pb-3 pt-3 backdrop-blur-xl max-md:-mx-4 max-md:-mt-4 max-md:px-4',
        isPhone() && 'relative',
        className
      )}
    >
      {chip ? (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-3">{children}</div>
          <GameChip className="mt-1" />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
