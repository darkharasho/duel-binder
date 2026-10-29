import { useEffect, useRef } from 'react'

/** Where a swipe began: within `edgeWidth` of the left edge, or anywhere else. */
export type SwipeZone = 'edge' | 'body'

export interface SwipeHandlers {
  /** No gestures are tracked while false. */
  enabled?: boolean
  /** Width of the left-edge zone in px, from the viewport's left. Defaults to 32. */
  edgeWidth?: number
  /** Which zones to track; a touch in another zone is left to the browser. */
  zones?: readonly SwipeZone[]
  /** The finger moved `dx` px sideways since the swipe locked horizontal. */
  onDrag?: (zone: SwipeZone, dx: number) => void
  /** The finger lifted (or the touch was cancelled, with dx 0); velocity in px/ms, + is rightward. */
  onRelease?: (zone: SwipeZone, dx: number, velocity: number) => void
}

/** Movement before a touch is judged a swipe or a scroll. */
const SLOP = 10
/** Horizontal movement must beat vertical by this factor to lock as a swipe. */
const DOMINANCE = 1.5

/** Controls that use horizontal drags themselves. */
const OWNS_DRAG =
  'input, textarea, select, [role="slider"], [contenteditable]:not([contenteditable="false"]), [data-swipe-ignore]'

/** Whether the touch began on a control, or in a row that scrolls sideways, below `root`. */
function ownsHorizontalDrag(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(OWNS_DRAG)) return true
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && scrollsSideways(el)) return true
  }
  return false
}

/** An `overflow-x-auto`/`-scroll` class (any variant) or inline overflow-x. */
const SIDEWAYS_CLASS = /(^|:)overflow-x-(auto|scroll)$/

/**
 * Whether `el` itself asks to scroll sideways. Computed style can't tell: a vertical scroller's
 * overflow-x computes to auto too, so this reads the element's own class and inline style.
 */
function scrollsSideways(el: Element): boolean {
  const inline = el instanceof HTMLElement ? el.style.overflowX : ''
  if (inline === 'auto' || inline === 'scroll') return true
  return [...el.classList].some((c) => SIDEWAYS_CLASS.test(c))
}

export const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Horizontal swipes on `el`, from touch events: a touch stays the browser's (so the page scrolls)
 * until its sideways movement clearly dominates, then locks as a swipe and stops the scroll.
 * Handlers are read fresh on every event. Takes the element itself (from a callback ref) so a
 * portalled element that mounts a render late is still picked up.
 */
export function useSwipe(el: HTMLElement | null, handlers: SwipeHandlers): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  const enabled = handlers.enabled ?? true

  useEffect(() => {
    if (!el || !enabled) return
    let track: {
      zone: SwipeZone
      x: number
      y: number
      state: 'pending' | 'locked'
      lastX: number
      lastT: number
      velocity: number
    } | null = null

    const start = (e: TouchEvent): void => {
      // A second finger ends the swipe under way, settling whatever it had moved.
      if (track) cancel()
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const h = latest.current
      const zones = h.zones ?? ['edge', 'body']
      // Measured from the viewport, so the zone holds still while the element slides in.
      const zone: SwipeZone = t.clientX <= (h.edgeWidth ?? 32) ? 'edge' : 'body'
      if (!zones.includes(zone)) return
      if (zone === 'body' && ownsHorizontalDrag(e.target, el)) return
      track = {
        zone,
        x: t.clientX,
        y: t.clientY,
        state: 'pending',
        lastX: t.clientX,
        lastT: performance.now(),
        velocity: 0
      }
    }

    const move = (e: TouchEvent): void => {
      if (!track) return
      if (e.touches.length !== 1) {
        cancel()
        return
      }
      const t = e.touches[0]
      const dx = t.clientX - track.x
      const dy = t.clientY - track.y
      if (track.state === 'pending') {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // A mostly vertical move is a scroll; an edge swipe only goes rightward.
        if (Math.abs(dx) < Math.abs(dy) * DOMINANCE || (track.zone === 'edge' && dx < 0)) {
          track = null
          return
        }
        track.state = 'locked'
      }
      if (e.cancelable) e.preventDefault()
      const now = performance.now()
      const dt = now - track.lastT
      if (dt > 0) {
        // Smoothed so one jittery sample doesn't decide a flick.
        const v = (t.clientX - track.lastX) / dt
        track.velocity = track.velocity * 0.2 + v * 0.8
      }
      track.lastX = t.clientX
      track.lastT = now
      latest.current.onDrag?.(track.zone, dx)
    }

    const end = (e: TouchEvent): void => {
      if (!track) return
      const done = track
      track = null
      if (done.state !== 'locked') return
      const t = e.changedTouches[0]
      const x = t ? t.clientX : done.lastX
      // A finger that stopped before lifting isn't flicking.
      const stale = performance.now() - done.lastT > 100
      latest.current.onRelease?.(done.zone, x - done.x, stale ? 0 : done.velocity)
    }

    const cancel = (): void => {
      if (track?.state === 'locked') latest.current.onRelease?.(track.zone, 0, 0)
      track = null
    }

    el.addEventListener('touchstart', start, { passive: true })
    // Not passive: a locked swipe stops the page scrolling under it.
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', cancel)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', cancel)
    }
  }, [el, enabled])
}
