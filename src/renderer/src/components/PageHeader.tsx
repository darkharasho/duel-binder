import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import { useGame } from '@/lib/game'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { GameChip } from './GameSwitch'

/** The big condensed page title: 96 px, 56 px under 1100 px. For a page that draws its own h1. */
export const PAGE_TITLE = 'font-display text-[56px] leading-[.8] min-[1100px]:text-[96px]'

/** True inside a desktop page header while its pinned row is held at the top of the page. */
const PinnedContext = createContext(false)
export const usePinned = (): boolean => useContext(PinnedContext)

/** How many headers are holding their row now; the title bar takes the wash colour while any are. */
let holding = 0

/** Gap between the top of the page and the pinned row, in px. */
const PIN_GAP = 12

/**
 * Desktop only: once the title scrolls away, keeps the header's `[data-pin]` row (the search and
 * Filters bar, or a binder's Back line) at the top of the page. The whole header is sticky with a
 * negative top, so everything above the pin row scrolls off and the row stays. Returns the sticky
 * top (null when there is nothing to pin) and whether the row is currently held.
 */
function usePin(
  ref: React.RefObject<HTMLDivElement | null>,
  on: boolean
): {
  top: number | null
  pinned: boolean
} {
  const [top, setTop] = useState<number | null>(null)
  const [pinned, setPinned] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!on || !el) return
    const pin = (): HTMLElement | null => el.querySelector<HTMLElement>('[data-pin]')
    const measure = (): void => {
      const row = pin()
      setTop(
        row ? PIN_GAP - (row.getBoundingClientRect().top - el.getBoundingClientRect().top) : null
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const scroller = el.closest('[data-main-scroll]')
    const onScroll = (): void => {
      const row = pin()
      // A page kept mounted but hidden (the Sets list under an open set) has no boxes: never held.
      if (!row || !scroller || row.getClientRects().length === 0) return setPinned(false)
      const scrollerTop = scroller.getBoundingClientRect().top
      const fromTop = row.getBoundingClientRect().top - scrollerTop
      const held = scroller.scrollTop > 0 && fromTop <= PIN_GAP + 0.5
      // The scrollbar track sits outside the fade, so it draws the same fade to this depth.
      const fade = el.querySelector(':scope > [data-pin-fade]')
      if (held && fade)
        document.documentElement.style.setProperty(
          '--pin-fade',
          `${fade.getBoundingClientRect().bottom - scrollerTop}px`
        )
      setPinned(held)
    }
    onScroll()
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      scroller?.removeEventListener('scroll', onScroll)
    }
  }, [ref, on])
  const held = on && top !== null && pinned
  // The title bar sits above the scrolling page, so it reads this to take the same colour.
  useLayoutEffect(() => {
    if (!held) return
    holding += 1
    document.documentElement.setAttribute('data-header-pinned', '')
    return () => {
      holding -= 1
      if (holding === 0) document.documentElement.removeAttribute('data-header-pinned')
    }
  }, [held])
  return { top: on ? top : null, pinned: held }
}

export interface PageStat {
  label: string
  value: React.ReactNode
}

/**
 * A page's header, first in a `p-8` page (`max-md:p-4` under 768 px). It has no box: the page's art
 * wash shows through. On desktop the title scrolls away but a child marked `data-pin` (the
 * FilterBar marks itself) stays pinned at the top; while held, a fade of the wash's base colour sits
 * behind it so cards scrolling under stay out of the way. On the phone it all scrolls away. `title` is the big condensed heading
 * (96 px, 56 px under 1100 px); `stats` sit right-aligned beside it, a mono value over a mono label.
 * Pages that draw their own heading pass it as children. On the phone it carries the game chip at its
 * right when the account has more than one game.
 */
export function PageHeader({
  className,
  title,
  stats,
  children
}: {
  className?: string
  title?: string
  stats?: PageStat[]
  children?: React.ReactNode
}): React.JSX.Element {
  const { available } = useGame()
  const chip = isPhone() && available.length > 1
  const phone = isPhone()
  const ref = useRef<HTMLDivElement>(null)
  const { top, pinned } = usePin(ref, !phone)
  const heading =
    title || stats?.length ? (
      <div
        className={cn(
          phone
            ? 'flex flex-col items-start gap-y-3'
            : 'flex flex-wrap items-end justify-between gap-x-8 gap-y-3'
        )}
      >
        {title && (
          <h1 className={cn(PAGE_TITLE, 'min-w-0 break-words', phone && 'text-[44px]')}>{title}</h1>
        )}
        {stats && stats.length > 0 && (
          <dl
            className={cn(
              'flex gap-8',
              phone ? 'justify-start gap-6 text-left' : 'ml-auto text-right'
            )}
          >
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col-reverse">
                <dt className="font-mono text-[10.5px] uppercase tracking-[1.5px]">{s.label}</dt>
                <dd
                  className={cn(
                    'font-mono font-medium leading-none',
                    phone ? 'text-[22px]' : 'text-[30px]'
                  )}
                >
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    ) : null
  const body = (
    <>
      {heading}
      {children}
    </>
  )
  return (
    <div
      ref={ref}
      data-page-header
      data-pinned={pinned || undefined}
      className={cn(
        'space-y-3 pb-3',
        phone ? 'relative' : top !== null && 'sticky z-20',
        className
      )}
      style={top !== null ? { top } : undefined}
    >
      {top !== null && (
        // Not a box: the wash's own base colour from the window's top edge (the title bar takes the
        // same colour, see TitleBar), fading out below the row.
        <div
          aria-hidden
          data-pin-fade
          className={cn(
            'pointer-events-none absolute -inset-x-8 bottom-[-24px] -z-10 transition-opacity duration-150',
            !pinned && 'opacity-0'
          )}
          style={{
            top: -top,
            background:
              'linear-gradient(180deg, var(--wash-base, var(--background)) calc(100% - 40px), transparent)'
          }}
        />
      )}
      <PinnedContext.Provider value={pinned}>
        {chip ? (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-3">{body}</div>
            <GameChip />
          </div>
        ) : (
          body
        )}
      </PinnedContext.Provider>
    </div>
  )
}
