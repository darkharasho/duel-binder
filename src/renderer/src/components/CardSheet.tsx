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
const SETTLE = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'

/** How far the card follows a drag toward a missing neighbour: a little, then less and less. */
const rubberBand = (dx: number): number => Math.sign(dx) * 48 * (1 - Math.exp(-Math.abs(dx) / 160))

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
  useEffect(() => () => clearTimeout(leaving.current), [])
  // Touches are ignored while the sheet slides away after a swipe back.
  const [isLeaving, setLeaving] = useState(false)

  const stepFor = (dx: number): (() => void) | undefined =>
    dx < 0 ? nav.current?.next : nav.current?.prev

  useSwipe(sheet, {
    enabled: phone && !isLeaving,
    onDrag: (zone, dx) => {
      if (zone === 'edge') place(sheet, Math.max(0, dx))
      else place(page.current, stepFor(dx) ? dx : rubberBand(dx))
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
      const step = stepFor(dx)
      if (step && passed(dx, velocity, width, STEP_SHARE)) {
        // The next card takes the place at once; the swipe was the motion.
        place(page.current, 0)
        step()
      } else settle(page.current)
    }
  })

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {phone ? (
        <SheetContent
          ref={setSheet}
          data-layout="full-screen"
          showCloseButton={false}
          className="inset-0 h-dvh w-full max-w-none touch-pan-y gap-0 overflow-x-hidden overflow-y-auto overscroll-contain border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none"
        >
          <div className="sticky top-0 z-10 bg-background/80 px-2 py-1 backdrop-blur-xl">
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
