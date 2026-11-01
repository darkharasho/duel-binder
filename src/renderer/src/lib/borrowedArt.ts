import { useEffect, useSyncExternalStore } from 'react'
import { gameOfId } from '@shared/games'
import { api } from '@/lib/api'

/**
 * Which cards show another card's art: read once as a whole, then again after a data change, since
 * every CardArt on a page wants it at the same moment. A card whose own art arrives drops out of
 * the list, and with it the label.
 */
let twins: Map<number, number> | null = null
let reading = false
let watching = false
const listeners = new Set<() => void>()

const notify = (): void => listeners.forEach((l) => l())

async function read(): Promise<void> {
  if (reading) return
  reading = true
  let pairs: [number, number][] = []
  try {
    pairs = await api.cards.borrowedArt()
  } catch {
    // Unreadable (offline web): the card's own art and placeholder, as if nothing were borrowed.
  }
  reading = false
  twins = new Map(pairs)
  notify()
}

/** A build without the channel (tests, a page rendered on its own) has nothing borrowed. */
const canRead = (): boolean => {
  try {
    return typeof api.cards.borrowedArt === 'function'
  } catch {
    return false
  }
}

function start(): void {
  if (!watching) {
    watching = true
    api.app.onDataChanged(() => void read())
  }
  if (twins === null) void read()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** For tests: forgets what was read. */
export function resetBorrowedArt(): void {
  twins = null
  reading = false
  watching = false
}

/**
 * The image a card shows in place of its own: null when it shows its own, undefined until that's
 * known. Waiting matters: asking for the card's own missing art first would fail it to a placeholder.
 */
export function useBorrowedArt(imageId: number): number | null | undefined {
  const possible = imageId > 0 && gameOfId(imageId) === 'pkm' && canRead()
  useEffect(() => {
    if (possible) start()
  }, [possible])
  return useSyncExternalStore(subscribe, () =>
    !possible ? null : twins === null ? undefined : (twins.get(imageId) ?? null)
  )
}
