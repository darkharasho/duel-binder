import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { SwipeNavContext, type PanelNav } from '@/components/panelNav'
import { isPhone } from '@/lib/platform'
import { prefersReducedMotion, useSwipe } from '@/lib/useSwipe'

/** Share of the width an edge swipe must pass to go back. */
const BACK_SHARE = 0.35
/** Share of the width a swipe across the card must pass to step. */
const STEP_SHARE = 0.25
/** A release this fast (px/ms) counts as a flick, whatever the distance. */
const FLICK = 0.5
/** A flick still has to travel this far, so a tap's wobble isn't one. */
const FLICK_MIN = 30
const SETTLE = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease-out'
/** How long the swiped card takes to leave the rest of the way. */
const EXIT_MS = 160
/** The swiped card carries on off the screen, like a card slid off the top of a hand. */
const EXIT = `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`
/** The next card slides in from the far side and eases to rest. */
const ENTER = 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)'

/** How far the card follows a drag toward a missing neighbour: a little, then less and less. */
const rubberBand = (dx: number): number => Math.sign(dx) * 48 * (1 - Math.exp(-Math.abs(dx) / 160))

/** Moves `el` to `x` at once. */
function place(el: HTMLElement | null, x: number): void {
  if (!el) return
  el.style.transition = 'none'
  el.style.transform = x === 0 ? '' : `translateX(${x}px)`
}

/** Eases `el` back to where it sat; at once when motion is reduced. */
function settle(el: HTMLElement | null): void {
  if (!el) return
  el.style.transition = prefersReducedMotion() ? 'none' : SETTLE
  el.style.transform = ''
}

/** Slides `el` in from `from` px to the side; at once when motion is reduced. */
function enter(el: HTMLElement | null, from: number): void {
  if (!el) return
  if (prefersReducedMotion()) return place(el, 0)
  place(el, from)
  // Commit the start position before the transition, or the browser skips straight to the end.
  void el.getBoundingClientRect()
  el.style.transition = ENTER
  el.style.transform = ''
}

/** Slides `el` off to the right, `width` px. */
function slideAway(el: HTMLElement, width: number): void {
  el.style.transition = SETTLE
  el.style.transform = `translateX(${width}px)`
}

const passed = (dx: number, velocity: number, width: number, share: number): boolean =>
  Math.abs(dx) > width * share ||
  (Math.abs(velocity) > FLICK && Math.abs(dx) > FLICK_MIN && Math.sign(velocity) === Math.sign(dx))

/**
 * The right-hand sheet a card panel renders into. Pages keep one mounted around whichever panel
 * is open, so stepping between cards swaps the panel without the sheet sliding out and back.
 * On the phone it fills the screen, with a back button in place of the close button; a swipe
 * from the left edge goes back, and a swipe across the card steps to its neighbours.
 */
export function CardSheet({
  onClose,
  children
}: {
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const phone = isPhone()
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const nav = useRef<PanelNav | undefined>(undefined)
  const registerNav = useCallback((n: PanelNav | undefined) => {
    nav.current = n
  }, [])
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Set while a swiped card slides off, so a second swipe can't start mid-step.
  const stepping = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(
    () => () => {
      clearTimeout(leaving.current)
      clearTimeout(stepping.current)
    },
    []
  )
  // The back bar is clear over the card's glow, and frosts once the page scrolls under it.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (!sheet) return
    const onScroll = (): void => setScrolled(sheet.scrollTop > 4)
    onScroll()
    sheet.addEventListener('scroll', onScroll, { passive: true })
    return () => sheet.removeEventListener('scroll', onScroll)
  }, [sheet])
  // Touches are ignored while the sheet slides away after a swipe back.
  const [isLeaving, setLeaving] = useState(false)

  const stepFor = (dx: number): (() => void) | undefined =>
    dx < 0 ? nav.current?.next : nav.current?.prev

  useSwipe(sheet, {
    enabled: phone && !isLeaving,
    onDrag: (zone, dx) => {
      if (zone === 'edge') place(sheet, Math.max(0, dx))
      else if (!stepping.current) place(page.current, stepFor(dx) ? dx : rubberBand(dx))
    },
    onRelease: (zone, dx, velocity) => {
      const width = sheet?.clientWidth || window.innerWidth
      if (zone === 'edge') {
        if (dx <= 0 || !passed(dx, velocity, width, BACK_SHARE)) return settle(sheet)
        if (prefersReducedMotion() || !sheet) return onClose()
        slideAway(sheet, width)
        setLeaving(true)
        leaving.current = setTimeout(onClose, 220)
        return
      }
      if (stepping.current) return
      const step = stepFor(dx)
      const el = page.current
      if (!step || !passed(dx, velocity, width, STEP_SHARE)) return settle(el)
      if (prefersReducedMotion() || !el) {
        step()
        return place(el, 0)
      }
      // The swipe carries this card off the screen, then the next slides in from the other side.
      const side = Math.sign(dx)
      el.style.transition = EXIT
      el.style.transform = `translateX(${side * width}px)`
      stepping.current = setTimeout(() => {
        stepping.current = undefined
        step()
        enter(el, -side * width)
      }, EXIT_MS)
    }
  })

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {phone ? (
        <SheetContent
          ref={setSheet}
          data-layout="full-screen"
          showCloseButton={false}
          // The sheet covers the page, so the page needn't be blurred behind it (iOS repaints that
          // blur every frame of the slide); and a quicker, eased-out slide feels lighter.
          overlayClassName="backdrop-blur-none"
          className="inset-0 h-dvh data-[state=open]:duration-[240ms] data-[state=open]:ease-out w-full max-w-none touch-pan-y gap-0 overflow-x-hidden overflow-y-auto overscroll-contain border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none"
        >
          <div
            data-scrolled={scrolled || undefined}
            className="sticky top-0 z-10 px-2 py-1 transition-[background-color,backdrop-filter] duration-200 data-[scrolled]:bg-background/80 data-[scrolled]:backdrop-blur-xl"
          >
            <Button variant="ghost" onClick={onClose}>
              <ChevronLeft />
              Back
            </Button>
          </div>
          <SwipeNavContext.Provider value={registerNav}>
            <div ref={page}>{children}</div>
          </SwipeNavContext.Provider>
        </SheetContent>
      ) : (
        <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
          {children}
        </SheetContent>
      )}
    </Sheet>
  )
}
