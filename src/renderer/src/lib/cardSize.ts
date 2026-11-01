import { useCallback, useSyncExternalStore } from 'react'

export type CardSize = 'small' | 'medium' | 'large'

export const CARD_SIZES: readonly { value: CardSize; label: string; name: string }[] = [
  { value: 'small', label: 'S', name: 'Small cards' },
  { value: 'medium', label: 'M', name: 'Medium cards' },
  { value: 'large', label: 'L', name: 'Large cards' }
]

/** How much wider a grid's tiles are than at small, the size they've always been. */
export const CARD_SCALE: Record<CardSize, number> = { small: 1, medium: 1.4, large: 1.9 }

const KEY = 'cards.size'

const isCardSize = (v: string | null): v is CardSize => v !== null && v in CARD_SCALE

let size: CardSize = 'small'
try {
  const saved = localStorage.getItem(KEY)
  if (isCardSize(saved)) size = saved
} catch {
  // Storage unavailable: small, for this session.
}

/** The grids size their columns from this, so a change needs no rerender of them. */
const apply = (): void =>
  document.documentElement.style.setProperty('--card-scale', String(CARD_SCALE[size]))
apply()

const listeners = new Set<() => void>()
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function write(next: CardSize): void {
  size = next
  apply()
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Remembered for this session only.
  }
  listeners.forEach((cb) => cb())
}

/** The card size for grids, remembered on this device. */
export function useCardSize(): [CardSize, (s: CardSize) => void] {
  const current = useSyncExternalStore(subscribe, () => size)
  const set = useCallback((s: CardSize) => write(s), [])
  return [current, set]
}

/** The image a grid tile needs: a small one blurs on a tile wider than itself. */
export function useTileImage(): 'small' | 'full' {
  return useCardSize()[0] === 'small' ? 'small' : 'full'
}
