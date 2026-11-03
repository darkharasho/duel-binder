import { useEffect, useRef } from 'react'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'

/** The nearest ancestor that scrolls vertically: the phone's full-screen sheet. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}

/**
 * Sets `--drawer-p` on the art, 0 at rest to 1 once the drawer has been scrolled up over the
 * whole card, eased so the card settles back softly instead of tracking the finger linearly.
 */
function useDrawerProgress(ref: React.RefObject<HTMLDivElement | null>, on: boolean): void {
  useEffect(() => {
    const art = ref.current
    if (!on || !art) return
    const scroller = scrollParent(art)
    if (!scroller) return
    let frame = 0
    const update = (): void => {
      frame = 0
      const range = Math.max(art.offsetHeight, 1)
      const t = Math.min(Math.max(scroller.scrollTop / range, 0), 1)
      const eased = 1 - (1 - t) ** 3
      art.style.setProperty(
        '--drawer-p',
        eased === 0 || eased === 1 ? String(eased) : eased.toFixed(3)
      )
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, on])
}

/**
 * A card panel's layout. On desktop: the header, then the art and the rest in one column. On the
 * phone the art floats pinned at the top over a soft glow, and the header and the rest sit on a
 * frosted drawer a little below it, so the whole card and the details show at once; scrolling
 * pulls the drawer up over the art, which eases back and blurs behind it.
 */
export function CardDrawer({
  header,
  art,
  children
}: {
  header: React.ReactNode
  art: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const phone = isPhone()
  const artRef = useRef<HTMLDivElement>(null)
  useDrawerProgress(artRef, phone && !!art)
  if (!phone) {
    return (
      <>
        {header}
        <div className="space-y-5 px-4 pb-6">
          {art}
          {children}
        </div>
      </>
    )
  }
  return (
    <>
      {/* Pinned under the sheet's back bar (2.75rem); the drawer scrolls up over it. */}
      {art && (
        <div ref={artRef} className="card-drawer-art sticky top-11 z-0 origin-top px-4 pt-2">
          {art}
        </div>
      )}
      <section
        aria-label="Card details"
        data-testid="card-drawer"
        className={cn(
          'relative z-[5] min-h-[70dvh] rounded-t-[28px] border-t border-white/[0.1] bg-background/60 shadow-[0_-12px_40px_rgb(0_0_0/0.35)] backdrop-blur-2xl',
          // A gap under the art so the whole card floats clear of the drawer at rest; none when
          // there's no art (still loading, or it sits beside the panel at 900px and wider).
          art && 'mt-6 min-[900px]:mt-0'
        )}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/25" />
        {header}
        <div className="space-y-5 px-4 pb-6">{children}</div>
      </section>
    </>
  )
}
