import { useCallback, useEffect, useState } from 'react'

/** More than a tall window shows, so a page paints full and the rest arrives behind it. */
const FIRST = 120
const STEP = 200
/** The list grows while its end is less than this many window heights below the window. */
const AHEAD = 2

/** Where there are no idle callbacks (Safari, so the iPhone app): a short timer instead. */
const TIMER_STEP_MS = 50

type Idle = { request: (cb: () => void) => number; cancel: (id: number) => void }

/** Idle callbacks, or timers where the browser has none. Looked up per use, so tests can stub them. */
function idleApi(): Idle {
  if (typeof requestIdleCallback === 'function')
    return {
      request: (cb) => requestIdleCallback(cb, { timeout: 100 }),
      cancel: (id) => cancelIdleCallback(id)
    }
  return {
    request: (cb) => window.setTimeout(cb, TIMER_STEP_MS),
    cancel: (id) => window.clearTimeout(id)
  }
}

/**
 * `items`, a first screenful at once and the rest in idle-time steps, so opening a page of a thousand
 * rows doesn't hold the window for the whole list. Steps stop while the list's end (the element
 * given `endRef`, usually the list itself) is well below the window and start again as it scrolls
 * near, so a collection of thousands only lays out what the scroll has come close to: a page with
 * every tile mounted is slow to leave and slow to change. Safari has no idle callbacks, so there
 * the steps run on timers: mounting a whole collection of thousands at once made the iPhone app's
 * scrolling lag.
 */
export function useChunkedList<T>(
  items: readonly T[]
): [shown: readonly T[], endRef: (el: Element | null) => void] {
  const [shown, setShown] = useState(FIRST)
  const [end, setEnd] = useState<Element | null>(null)
  const endRef = useCallback((el: Element | null) => setEnd(el), [])
  const more = shown < items.length
  useEffect(() => {
    if (!more) return
    const near = (): boolean =>
      !end || end.getBoundingClientRect().bottom < window.innerHeight * (1 + AHEAD)
    const { request, cancel } = idleApi()
    let idle = 0
    const grow = (): void => {
      if (!near()) return
      stopWatching()
      idle = request(() => setShown((n) => n + STEP))
    }
    // Any scroll on the page (the list sits in a scrolling main, not the window) may bring it near.
    const stopWatching = (): void => {
      document.removeEventListener('scroll', grow, true)
      window.removeEventListener('resize', grow)
    }
    document.addEventListener('scroll', grow, { capture: true, passive: true })
    window.addEventListener('resize', grow)
    // Measured once the step that grew the list has been laid out.
    idle = request(grow)
    return () => {
      stopWatching()
      cancel(idle)
    }
  }, [more, shown, end])
  return [more ? items.slice(0, shown) : items, endRef]
}
