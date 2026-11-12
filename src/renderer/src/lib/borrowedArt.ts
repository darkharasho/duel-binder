import { useEffect, useSyncExternalStore } from 'react'
import { gameOfId } from '@shared/games'
import { api } from '@/lib/api'
import { switchingGame } from '@/lib/game'

/**
 * Which cards show another card's art: read once as a whole, then again after a data change, since
 * every CardArt on a page wants it at the same moment. The lists are the catalog's, the same for
 * every game, so a game switch (which says data changed) doesn't read them again; a data change
 * while no Pokémon card shows only marks them stale, read when one next shows. A card whose own art arrives drops out of
 * the list, and with it the label. Traditional Chinese art comes first; an older portal doesn't
 * have that list, and the English twins still show. Some English twins are Japanese cards (a set
 * printed from a Japanese one): those are labelled Japanese, and an older portal calls them English.
 */
export interface BorrowedArt {
  imageId: number
  language: 'en' | 'ja' | 'zh-hant'
}

let twins: Map<number, BorrowedArt> | null = null
let reading = false
/** A data change came while reading: read once more after, so the change isn't missed. */
let again = false
/** A data change came while no Pokémon card showed: read when one next does. */
let stale = false
let watching = false
/** Pokémon cards showing now (CardArts that may borrow art). */
let viewers = 0
const listeners = new Set<() => void>()

const notify = (): void => listeners.forEach((l) => l())

/** Unreadable (offline web): the card's own art and placeholder, as if nothing were borrowed. */
const pairsOf = async (list: () => Promise<[number, number][]>): Promise<[number, number][]> => {
  try {
    return await list()
  } catch {
    return []
  }
}

async function read(): Promise<void> {
  if (reading) {
    again = true
    return
  }
  reading = true
  stale = false
  const [english, japanese, traditional] = await Promise.all([
    pairsOf(() => api.cards.borrowedArt()),
    pairsOf(() => api.cards.japaneseArt()),
    pairsOf(() => api.cards.traditionalArt())
  ])
  reading = false
  twins = new Map()
  for (const [own, imageId] of english) twins.set(own, { imageId, language: 'en' })
  for (const [own, imageId] of japanese) twins.set(own, { imageId, language: 'ja' })
  for (const [own, imageId] of traditional) twins.set(own, { imageId, language: 'zh-hant' })
  notify()
  if (again) {
    again = false
    void read()
  }
}

function changed(): void {
  // A game switch from this window: the lists don't depend on the game.
  if (switchingGame()) return
  if (viewers > 0) void read()
  else stale = true
}

/** A build without the channel (tests, a page rendered on its own) has nothing borrowed. */
const canRead = (): boolean => {
  try {
    return typeof api.cards.borrowedArt === 'function'
  } catch {
    return false
  }
}

/** A Pokémon card shows: reads the lists if not read yet or stale; returns its goodbye. */
function start(): () => void {
  viewers++
  if (!watching) {
    watching = true
    api.app.onDataChanged(changed)
  }
  if (twins === null || stale) void read()
  return () => {
    viewers--
  }
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** For tests: forgets what was read. */
export function resetBorrowedArt(): void {
  twins = null
  reading = false
  again = false
  stale = false
  watching = false
  viewers = 0
}

/**
 * The image a card shows in place of its own: null when it shows its own, undefined until that's
 * known. Waiting matters: asking for the card's own missing art first would fail it to a placeholder.
 */
export function useBorrowedArt(imageId: number): BorrowedArt | null | undefined {
  // Kind A: borrowed art is Pokémon-only (twins); 'op' shows its own art.
  const possible = imageId > 0 && gameOfId(imageId) === 'pkm' && canRead()
  useEffect(() => (possible ? start() : undefined), [possible])
  return useSyncExternalStore(subscribe, () =>
    !possible ? null : twins === null ? undefined : (twins.get(imageId) ?? null)
  )
}
