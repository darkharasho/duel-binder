import { useEffect, useState } from 'react'

/** More than a tall window shows, so a page paints full and the rest arrives behind it. */
const FIRST = 120
const STEP = 200

/**
 * `items`, a first screenful at once and the rest in idle-time steps, so opening a page of a thousand
 * rows doesn't hold the window for the whole list. Without idle callbacks (Safari, tests) it's all
 * of them at once.
 */
export function useChunkedList<T>(items: readonly T[]): readonly T[] {
  const [shown, setShown] = useState(() =>
    typeof requestIdleCallback === 'function' ? FIRST : Infinity
  )
  const more = shown < items.length
  useEffect(() => {
    if (!more) return
    const id = requestIdleCallback(() => setShown((n) => n + STEP), { timeout: 100 })
    return () => cancelIdleCallback(id)
  }, [more, shown])
  return more ? items.slice(0, shown) : items
}
