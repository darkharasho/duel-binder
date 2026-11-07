import { POKEDEX_SIZE } from '../../../src/shared/pokedex'
import { baseEnglish } from './englishNames'
import { namePart, plainName } from './match'
import type { PkmLang } from './types'

export interface DexInput {
  cardId: number
  lang: PkmLang
  category: string | undefined
  /** TCGdex's, as fetched. */
  dexId: number[] | undefined
  /** The card's English name (CardPlan.name). */
  name: string
  /** artTwinId then traditionalTwinId, nulls dropped. */
  twinIds: number[]
}

const inRange = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= POKEDEX_SIZE
const sorted = (ids: number[]): number[] => [...new Set(ids)].sort((a, b) => a - b)

/** The same normalisation speciesCheck gives an English name. */
const nameKey = (name: string): string => plainName(baseEnglish(namePart(name)))

/**
 * Each Pokémon card's species, as National Pokédex numbers (ascending, unique). TCGdex's `dexId` is
 * the source; its Japanese one is wrong now and then, so a Japanese or Traditional card with one
 * species follows its English name when that names a single other species. Cards with no `dexId`
 * (Simplified, TCGplayer-only) borrow a twin's species, else their English name's.
 */
export function resolveDexIds(cards: DexInput[]): Map<number, number[]> {
  const own = (c: DexInput): number[] => sorted((c.dexId ?? []).filter(inRange))
  const isPokemon = (c: DexInput): boolean => c.category === 'Pokemon'

  const names = new Map<string, Set<number>>()
  for (const c of cards) {
    const ids = own(c)
    if (c.lang !== 'en' || !isPokemon(c) || ids.length !== 1) continue
    const key = nameKey(c.name)
    if (!key) continue
    const set = names.get(key)
    if (set) set.add(ids[0])
    else names.set(key, new Set(ids))
  }
  const byName = (c: DexInput): number | undefined => {
    const set = names.get(nameKey(c.name))
    return set?.size === 1 ? [...set][0] : undefined
  }

  const out = new Map<number, number[]>()
  for (const c of cards) {
    if (!isPokemon(c)) continue
    const ids = own(c)
    if (ids.length === 0) continue
    if (ids.length === 1 && (c.lang === 'ja' || c.lang === 'zh-hant')) {
      const named = byName(c)
      out.set(c.cardId, [named !== undefined && named !== ids[0] ? named : ids[0]])
    } else out.set(c.cardId, ids)
  }
  for (const c of cards) {
    if (!isPokemon(c) || own(c).length > 0) continue
    const twin = c.twinIds.find((id) => out.has(id))
    const named = twin === undefined ? byName(c) : undefined
    if (twin !== undefined) out.set(c.cardId, out.get(twin)!)
    else if (named !== undefined) out.set(c.cardId, [named])
  }
  return out
}

/** A card's `dex_no` (first species) and `dex_extra` (the others, comma-separated). */
export function dexColumns(ids: number[]): { dexNo: number | null; dexExtra: string | null } {
  if (ids.length === 0) return { dexNo: null, dexExtra: null }
  return { dexNo: ids[0], dexExtra: ids.length > 1 ? ids.slice(1).join(',') : null }
}
