import type { BinderGoal } from '@shared/binders'
import type { GameId } from '@shared/games'
import type { BinderCard } from '@shared/types'
import { sortOptions, type SortOption } from '@/lib/filters'

export type BinderSort = 'release' | 'name' | 'type' | 'number' | 'price'
export type SortDir = 'asc' | 'desc'
export interface BinderOrder {
  by: BinderSort
  dir: SortDir
}

export const DEFAULT_BINDER_ORDER: BinderOrder = { by: 'release', dir: 'asc' }

const SORTS = [
  { value: 'release', label: 'Release date', kind: 'date', dir: 'asc' },
  { value: 'name', label: 'Name', kind: 'text', dir: 'asc' },
  { value: 'type', label: 'Type', kind: 'text', dir: 'asc' },
  { value: 'number', label: 'Set number', kind: 'text', dir: 'asc' },
  { value: 'price', label: 'Price', kind: 'number', dir: 'desc' }
] as const

/** Sort choices for a binder. Set number needs a printing per slot, so only a printing goal has it. */
export const binderSorts = (goal: BinderGoal): SortOption<BinderSort>[] =>
  sortOptions<BinderSort>(SORTS.filter((s) => s.value !== 'number' || goal === 'printing'))

const rank = (order: readonly string[], v: string | null | undefined): number => {
  const i = v ? order.indexOf(v) : -1
  return i === -1 ? order.length : i
}

const YGO_FRAMES = [
  'normal',
  'effect',
  'ritual',
  'fusion',
  'synchro',
  'xyz',
  'link',
  'normal_pendulum',
  'effect_pendulum',
  'ritual_pendulum',
  'fusion_pendulum',
  'synchro_pendulum',
  'xyz_pendulum',
  'spell',
  'trap',
  'token',
  'skill'
]
const PKM_CATEGORIES = ['Pokemon', 'Trainer', 'Energy']
const PKM_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Fairy',
  'Dragon',
  'Colorless'
]
const OP_TYPES = ['Leader', 'Character', 'Event', 'Stage', 'DON!!']
const OP_COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow']

/**
 * A card's place in its game's own type order: monsters by frame then spells and traps; Pokémon by
 * energy type then Trainers and Energy; One Piece by card type then colour.
 */
function typeKey(c: BinderCard, game: GameId): number[] {
  const { card } = c
  if (game === 'pkm') {
    return [rank(PKM_CATEGORIES, card.type), rank(PKM_TYPES, card.pokemon?.types[0])]
  }
  if (game === 'op') {
    return [rank(OP_TYPES, card.onePiece?.cardType), rank(OP_COLORS, card.onePiece?.colors[0])]
  }
  return [rank(YGO_FRAMES, card.frameType)]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** The value a slot sorts by, or null when it has none (those go last either way). */
function sortValue(c: BinderCard, by: BinderSort, game: GameId): string | number | number[] | null {
  switch (by) {
    case 'release':
      return c.releaseDate || null
    case 'name':
      return c.card.name
    case 'type':
      return typeKey(c, game)
    case 'number':
      return c.printing?.setCode || null
    case 'price':
      return c.price ?? c.printing?.setPrice ?? null
  }
}

function compare(a: string | number | number[], b: string | number | number[]): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

/**
 * Slots in the chosen order. Ties fall back to release date, then set number, then name, so a
 * type's cards read in the order they came out; slots with nothing to sort by go last.
 */
export function sortBinderCards(
  cards: readonly BinderCard[],
  order: BinderOrder,
  game: GameId
): BinderCard[] {
  const sign = order.dir === 'asc' ? 1 : -1
  const keys: BinderSort[] = [order.by, 'release', 'number', 'name']
  return cards
    .map((c, i) => ({ c, i }))
    .sort((x, y) => {
      for (const [n, key] of keys.entries()) {
        const a = sortValue(x.c, key, game)
        const b = sortValue(y.c, key, game)
        if (a === null && b === null) continue
        if (a === null) return 1
        if (b === null) return -1
        const d = compare(a, b)
        if (d !== 0) return n === 0 ? sign * d : d
      }
      return x.i - y.i
    })
    .map((x) => x.c)
}

const KEY = (uid: string): string => `binder-sort:${uid}`

/** The order this binder was last shown in on this device. */
export function readBinderOrder(uid: string, goal: BinderGoal): BinderOrder {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY(uid)) ?? 'null') as BinderOrder | null
    if (saved && binderSorts(goal).some((o) => o.value === saved.by && o.dir === saved.dir)) {
      return saved
    }
  } catch {
    /* storage unavailable or bad: the default order */
  }
  return DEFAULT_BINDER_ORDER
}

export function saveBinderOrder(uid: string, order: BinderOrder): void {
  try {
    localStorage.setItem(KEY(uid), JSON.stringify(order))
  } catch {
    /* storage unavailable: the order just isn't remembered */
  }
}
