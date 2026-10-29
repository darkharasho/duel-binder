import { createContext, useContext, useEffect, useRef } from 'react'

/** Steps a side panel to the previous/next card of the page's list; a missing step is an end. */
export interface PanelNav {
  prev?: () => void
  next?: () => void
}

/**
 * Navigation to the neighbours of `items[index]`, opening each with `open` and scrolling its
 * tile (marked `data-nav-key`) into view. Undefined when the open item isn't in the list.
 */
export function listNav<T>(
  items: readonly T[],
  index: number,
  open: (item: T) => void,
  key: (item: T) => string | number
): PanelNav | undefined {
  if (index === -1) return undefined
  const step = (i: number): (() => void) | undefined => {
    const item = items[i]
    if (item === undefined) return undefined
    return () => {
      open(item)
      document
        .querySelector(`[data-nav-key=${JSON.stringify(String(key(item)))}]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }
  return { prev: step(index - 1), next: step(index + 1) }
}

/** Fields and open popups keep their own arrow keys. */
function ownsArrowKeys(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="listbox"], [role="combobox"]'
    ) !== null
  )
}

/** ArrowLeft / ArrowRight step the open panel, unless focus is somewhere that uses them. */
export function usePanelNavKeys(nav: PanelNav | undefined): void {
  const latest = useRef(nav)
  useEffect(() => {
    latest.current = nav
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const step =
        e.key === 'ArrowLeft'
          ? latest.current?.prev
          : e.key === 'ArrowRight'
            ? latest.current?.next
            : undefined
      if (!step || ownsArrowKeys(e.target)) return
      e.preventDefault()
      step()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Lets a card panel hand its nav to the CardSheet around it, which steps it on a swipe (phone).
 * The value records the latest nav; null outside a CardSheet.
 */
export const SwipeNavContext = createContext<((nav: PanelNav | undefined) => void) | null>(null)

/** Hands `nav` to the surrounding CardSheet's swipe, if any, for as long as this is mounted. */
export function useSwipeNav(nav: PanelNav | undefined): void {
  const register = useContext(SwipeNavContext)
  useEffect(() => {
    register?.(nav)
  })
  useEffect(() => () => register?.(undefined), [register])
}
