import type { LanguageFilter } from '@shared/languages'
import type { GameId } from '@shared/games'
import { setType, type SetType } from '@shared/setTypes'
import { englishSetName } from '@shared/setNames'
import { rarityRank } from '@shared/scan/rarity'
import { matchesSetSearch, sortOptions, type SortOption } from '@/lib/filters'
import { matchesLanguage } from '@/lib/languageFilter'
import type {
  ChecklistCard,
  ChecklistRarity,
  CountMode,
  SetChecklist,
  SetSummary
} from '@shared/types'

export type SetFilter = 'started' | 'all' | 'complete'
export type SetSort = 'complete' | 'name' | 'date'
export type TileFilter = 'all' | 'owned' | 'missing'
export type ChecklistSort = 'number' | 'name' | 'price' | 'atk' | 'def' | 'level' | 'hp'
export type SortDir = 'asc' | 'desc'

const CHECKLIST_SORTS = [
  { value: 'number', label: 'Set number', kind: 'number', dir: 'asc' },
  { value: 'name', label: 'Name', kind: 'text', dir: 'asc' },
  { value: 'price', label: 'Price', kind: 'number', dir: 'desc' },
  { value: 'atk', label: 'ATK', kind: 'number', dir: 'desc' },
  { value: 'def', label: 'DEF', kind: 'number', dir: 'desc' },
  { value: 'level', label: 'Level / Link', kind: 'number', dir: 'desc' },
  { value: 'hp', label: 'HP', kind: 'number', dir: 'desc' }
] as const

/** Sort choices for a set's cards: ATK, DEF and Level are Yu-Gi-Oh!'s, HP is Pokémon's. */
export const checklistSorts = (game: GameId): SortOption<ChecklistSort>[] =>
  sortOptions<ChecklistSort>(
    CHECKLIST_SORTS.filter((s) =>
      game === 'pkm' ? !['atk', 'def', 'level'].includes(s.value) : s.value !== 'hp'
    )
  )

export interface Progress {
  owned: number
  total: number
  percent: number
  complete: boolean
}

export interface Tile {
  key: string
  card: ChecklistCard
  rarity: string | null
  owned: number
  entryId: number | null
}

export function progressFor(s: SetSummary, mode: CountMode): Progress {
  const owned = mode === 'cards' ? s.ownedCards : s.ownedRarities
  const total = mode === 'cards' ? s.totalCards : s.totalRarities
  return {
    owned,
    total,
    percent: total > 0 ? Math.floor((owned / total) * 100) : 0,
    complete: total > 0 && owned === total
  }
}

export function setsHeader(
  sets: SetSummary[],
  mode: CountMode
): { started: number; total: number; complete: number } {
  let started = 0
  let complete = 0
  for (const s of sets) {
    const p = progressFor(s, mode)
    if (p.owned > 0) started++
    if (p.complete) complete++
  }
  return { started, total: sets.length, complete }
}

function passesProgress(s: SetSummary, filter: SetFilter, mode: CountMode): boolean {
  const p = progressFor(s, mode)
  if (filter === 'started') return p.owned > 0
  if (filter === 'complete') return p.complete
  return true
}

export function filterSets(
  sets: SetSummary[],
  o: {
    filter: SetFilter
    q: string
    mode: CountMode
    language: LanguageFilter
    types: SetType[]
    game?: GameId
  }
): SetSummary[] {
  return sets.filter((s) => {
    if (!matchesLanguage(o.language, s.language)) return false
    if (!passesProgress(s, o.filter, o.mode)) return false
    if (o.types.length > 0 && !o.types.includes(setType(s, o.game))) return false
    return matchesSetSearch(s, o.q)
  })
}

/** Sets per type after language and progress, ignoring search and the type filter. */
export function typeCounts(
  sets: SetSummary[],
  o: { filter: SetFilter; mode: CountMode; language: LanguageFilter; game?: GameId }
): Record<SetType, number> {
  const counts: Record<SetType, number> = { booster: 0, deck: 0, tin: 0, collection: 0, promo: 0 }
  for (const s of sets) {
    if (!matchesLanguage(o.language, s.language)) continue
    if (!passesProgress(s, o.filter, o.mode)) continue
    counts[setType(s, o.game)]++
  }
  return counts
}

export function sortSets(sets: SetSummary[], sort: SetSort, mode: CountMode): SetSummary[] {
  const byName = (a: SetSummary, b: SetSummary): number =>
    englishSetName(a.setName, a.setCode).localeCompare(englishSetName(b.setName, b.setCode))
  const out = [...sets]
  if (sort === 'name') return out.sort(byName)
  if (sort === 'date') {
    return out.sort((a, b) => {
      if (a.tcgDate === b.tcgDate) return byName(a, b)
      if (a.tcgDate === null) return 1
      if (b.tcgDate === null) return -1
      return a.tcgDate < b.tcgDate ? 1 : -1
    })
  }
  return out.sort((a, b) => {
    const pa = progressFor(a, mode)
    const pb = progressFor(b, mode)
    return pb.percent - pa.percent || pb.owned - pa.owned || byName(a, b)
  })
}

/** Sets releasing more than this many days from today sit under the "upcoming" banner. */
export const UPCOMING_DAYS = 30

/** The last release date ('YYYY-MM-DD', local) that still shows in the main list. */
export function upcomingCutoff(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + UPCOMING_DAYS)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A not-yet-started set releasing after the cutoff. Undated and started sets never are. */
export function isUpcoming(s: SetSummary, cutoff: string): boolean {
  if (s.tcgDate === null || s.ownedCards > 0 || s.ownedRarities > 0) return false
  return s.tcgDate.slice(0, 10) > cutoff
}

/** Splits sets into the main list and the upcoming ones, keeping each side's order. */
export function splitUpcoming(
  sets: SetSummary[],
  cutoff: string
): { current: SetSummary[]; upcoming: SetSummary[] } {
  const current: SetSummary[] = []
  const upcoming: SetSummary[] = []
  for (const s of sets) (isUpcoming(s, cutoff) ? upcoming : current).push(s)
  return { current, upcoming }
}

export function checklistTiles(cl: SetChecklist, mode: CountMode): Tile[] {
  if (mode === 'cards') {
    return cl.cards.map((card) => ({
      key: String(card.cardId),
      card,
      rarity: null,
      owned: card.owned,
      entryId: card.entryId
    }))
  }
  return cl.cards.flatMap((card) =>
    card.rarities.map((r) => ({
      key: `${card.cardId}|${r.rarity}`,
      card,
      rarity: r.rarity,
      owned: r.owned,
      entryId: r.entryId
    }))
  )
}

/**
 * What a tile sorts by under Price, and the rarity it comes from: the tile's own, or a card
 * tile's dearest, since its art is the first rarity's and may be far cheaper.
 */
export function tilePrice(t: Tile): { price: number | null; rarity: string | null } {
  const c = t.card
  if (t.rarity !== null) {
    const own = c.rarities.find((x) => x.rarity === t.rarity)
    return { price: own?.price ?? c.price, rarity: t.rarity }
  }
  const dearest = c.rarities.find((x) => x.price !== null && x.price === c.price)
  return { price: c.price, rarity: dearest?.rarity ?? null }
}

function sortValue(t: Tile, sort: ChecklistSort): number | string | null {
  const c = t.card
  switch (sort) {
    case 'number':
      return c.number
    case 'name':
      return c.name
    case 'price':
      return tilePrice(t).price
    case 'hp':
      return c.hp ?? null
    default:
      return c[sort]
  }
}

/**
 * Tiles in the chosen order. Cards without the value (a spell's ATK, an unpriced card) go last
 * either way; ties keep the set's own order.
 */
export function sortTiles(tiles: Tile[], sort: ChecklistSort, dir: SortDir): Tile[] {
  const sign = dir === 'asc' ? 1 : -1
  return tiles
    .map((t, i) => ({ t, i, v: sortValue(t, sort) }))
    .sort((a, b) => {
      if (a.v !== b.v) {
        if (a.v === null) return 1
        if (b.v === null) return -1
        const d = typeof a.v === 'string' ? a.v.localeCompare(String(b.v)) : a.v - Number(b.v)
        if (d !== 0) return sign * d
      }
      return a.i - b.i
    })
    .map((x) => x.t)
}

/** Cards in the chosen order, as `sortTiles` orders one tile per card. */
export function sortCards(
  cards: ChecklistCard[],
  sort: ChecklistSort,
  dir: SortDir
): ChecklistCard[] {
  const tiles = cards.map((card) => ({
    key: String(card.cardId),
    card,
    rarity: null,
    owned: card.owned,
    entryId: card.entryId
  }))
  return sortTiles(tiles, sort, dir).map((t) => t.card)
}

export function filterTiles(tiles: Tile[], f: TileFilter): Tile[] {
  if (f === 'owned') return tiles.filter((t) => t.owned > 0)
  if (f === 'missing') return tiles.filter((t) => t.owned === 0)
  return tiles
}

/** Pokémon rarities low to high; others follow by name. Compared case-insensitively. */
const POKEMON_RARITY_ORDER = [
  'common',
  'uncommon',
  'rare',
  'rare holo',
  'double rare',
  'art rare',
  'ultra rare',
  'illustration rare',
  'special illustration rare',
  'hyper rare',
  'mega hyper rare'
]

const UNKNOWN_RARITY = 'Unknown'

/** The rarity a Pokémon card is grouped under; undefined for Yu-Gi-Oh! cards. */
const cardRarityOf = (card: ChecklistCard): string | undefined =>
  card.cardRarity === undefined ? undefined : card.cardRarity?.trim() || UNKNOWN_RARITY

function pokemonRank(rarity: string): number {
  if (rarity === UNKNOWN_RARITY) return Number.MAX_SAFE_INTEGER
  const i = POKEMON_RARITY_ORDER.indexOf(rarity.toLowerCase())
  return i === -1 ? POKEMON_RARITY_ORDER.length : i
}

/**
 * The rarities present in a set with how many cards have each, lowest rarity first. Yu-Gi-Oh!
 * cards count once per rarity they have, so a card in two rarities is in two counts. Pokémon
 * cards carry one rarity of their own (their finishes aren't rarities), so the counts add up to
 * the set; cards with none are "Unknown", last.
 */
export function rarityCounts(cl: SetChecklist): { rarity: string; count: number }[] {
  // Keyed by lower case since TCGdex's casing varies ("Illustration rare"); the first spelling shows.
  const counts = new Map<string, { rarity: string; count: number }>()
  const bump = (r: string): void => {
    const e = counts.get(r.toLowerCase()) ?? { rarity: r, count: 0 }
    e.count++
    counts.set(r.toLowerCase(), e)
  }
  for (const card of cl.cards) {
    const own = cardRarityOf(card)
    if (own !== undefined) bump(own)
    else for (const r of card.rarities) bump(r.rarity)
  }
  const rank = cl.cards.some((c) => c.cardRarity !== undefined) ? pokemonRank : rarityRank
  return [...counts.values()].sort(
    (a, b) => rank(a.rarity) - rank(b.rarity) || a.rarity.localeCompare(b.rarity)
  )
}

/**
 * Tiles of one rarity; null keeps all. A Pokémon card keeps every finish tile when its rarity
 * matches. A Yu-Gi-Oh! card's tile in 'cards' mode stays if the card has the rarity.
 */
export function filterTilesByRarity(tiles: Tile[], picked: string[]): Tile[] {
  if (picked.length === 0) return tiles
  const lower = picked.map((p) => p.toLowerCase())
  return tiles.filter((t) => {
    const own = cardRarityOf(t.card)
    if (own !== undefined) return lower.includes(own.toLowerCase())
    return t.rarity !== null
      ? picked.includes(t.rarity)
      : t.card.rarities.some((r) => picked.includes(r.rarity))
  })
}

/** The versions most cards come in, first; others follow by name. */
const VERSION_ORDER = ['Normal', 'Holofoil', 'Reverse Holofoil']
const versionRank = (v: string): number => {
  const at = VERSION_ORDER.indexOf(v)
  return at < 0 ? VERSION_ORDER.length : at
}

/** A Pokémon set's versions (finishes) with how many cards come in each; none for Yu-Gi-Oh!. */
export function versionCounts(cl: SetChecklist): { version: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const card of cl.cards) {
    if (cardRarityOf(card) === undefined) continue
    for (const r of card.rarities) counts.set(r.rarity, (counts.get(r.rarity) ?? 0) + 1)
  }
  return [...counts]
    .map(([version, count]) => ({ version, count }))
    .sort(
      (a, b) =>
        versionRank(a.version) - versionRank(b.version) || a.version.localeCompare(b.version)
    )
}

/** Tiles of the picked versions: a version's own tile, or a card's that comes in one. */
export function filterTilesByVersion(tiles: Tile[], picked: string[]): Tile[] {
  if (picked.length === 0) return tiles
  return tiles.filter((t) =>
    t.rarity !== null
      ? picked.includes(t.rarity)
      : t.card.rarities.some((r) => picked.includes(r.rarity))
  )
}

/** The checklist with one card replaced by id and the set's owned counts recomputed from the cards. */
export function replaceChecklistCard(cl: SetChecklist, card: ChecklistCard): SetChecklist {
  const cards = cl.cards.map((c) => (c.cardId === card.cardId ? card : c))
  return {
    set: {
      ...cl.set,
      ownedCards: cards.filter((c) => c.owned > 0).length,
      ownedRarities: cards.reduce((n, c) => n + c.rarities.filter((r) => r.owned > 0).length, 0)
    },
    cards
  }
}

/**
 * The card as it will be after one +/- of a printing, never below zero (removing an unowned
 * printing is a no-op on the server too). Entry ids are left for the server's answer to fill.
 */
export function adjustChecklistCard(
  card: ChecklistCard,
  printingId: number,
  delta: 1 | -1
): ChecklistCard {
  let change = 0
  const rarities = card.rarities.map((r) => {
    if (!r.codes.some((c) => c.printingId === printingId)) return r
    const codes = r.codes.map((c) => {
      if (c.printingId !== printingId) return c
      const owned = Math.max(0, c.owned + delta)
      change = owned - c.owned
      return { ...c, owned }
    })
    return { ...r, codes, owned: r.owned + change }
  })
  return change === 0 ? card : { ...card, rarities, owned: card.owned + change }
}

/** The set list with one set's owned counts taken from its (fresher) summary. */
export function patchSetSummary(list: SetSummary[], set: SetSummary): SetSummary[] {
  return list.map((s) =>
    s.language === set.language && s.setName === set.setName
      ? { ...s, ownedCards: set.ownedCards, ownedRarities: set.ownedRarities }
      : s
  )
}

/** Whether a checklist card matches a search: name, number label or any of its set codes. */
export function matchesCardSearch(card: ChecklistCard, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    card.name.toLowerCase().includes(needle) ||
    card.numberLabel.toLowerCase().includes(needle) ||
    card.rarities.some((r) => r.codes.some((c) => c.setCode.toLowerCase().includes(needle)))
  )
}

export interface BulkTileData {
  key: string
  card: ChecklistCard
  rarity: ChecklistRarity
}

/** One bulk-add tile per (card, rarity), in card order. */
export function bulkTiles(cards: ChecklistCard[]): BulkTileData[] {
  return cards.flatMap((card) =>
    card.rarities.map((rarity) => ({ key: `${card.cardId}:${rarity.rarity}`, card, rarity }))
  )
}

/** Bulk search: a bare number jumps to that set number; anything else is the usual text search. */
export function filterBulkCards(cards: ChecklistCard[], q: string): ChecklistCard[] {
  const needle = q.trim()
  if (!needle) return cards
  if (/^\d+$/.test(needle)) {
    const n = Number(needle)
    const exact = cards.filter((c) => c.number === n)
    if (exact.length) return exact
  }
  return cards.filter((c) => matchesCardSearch(c, q))
}
