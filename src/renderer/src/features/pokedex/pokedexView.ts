import { GENERATIONS, POKEDEX_SIZE, SPECIES, generationOf } from '@shared/pokedex'
import type { PokedexSummary } from '@shared/types'

export type DexFilter = 'all' | 'caught' | 'missing'

/** One species on the page. `copies` 0 is missing. */
export interface DexTile {
  dexNo: number
  name: string
  copies: number
}

/** Every species, in dex order, with the copies the summary counts for it. */
export function dexTiles(summary: PokedexSummary): DexTile[] {
  const copies = new Map(summary.caught.map((c) => [c.dexNo, c.copies]))
  return SPECIES.slice(0, POKEDEX_SIZE).map((name, i) => ({
    dexNo: i + 1,
    name,
    copies: copies.get(i + 1) ?? 0
  }))
}

const inGen = (dexNo: number, gen: number | null): boolean =>
  gen === null || generationOf(dexNo) === gen

/** The tiles the filter and generation (null: every one) keep. */
export function visibleTiles(tiles: DexTile[], filter: DexFilter, gen: number | null): DexTile[] {
  return tiles.filter(
    (t) =>
      inGen(t.dexNo, gen) &&
      (filter === 'all' || (filter === 'caught' ? t.copies > 0 : t.copies === 0))
  )
}

/** Caught out of all, over the whole dex or one generation. */
export function progress(tiles: DexTile[], gen?: number): { caught: number; total: number } {
  let caught = 0
  let total = 0
  for (const t of tiles) {
    if (!inGen(t.dexNo, gen ?? null)) continue
    total++
    if (t.copies > 0) caught++
  }
  return { caught, total }
}

/** `#006`, `#1025`. */
export const dexNumber = (n: number): string => `#${String(n).padStart(3, '0')}`

/** A whole percentage, never 100 before the last one. */
export const percent = ({ caught, total }: { caught: number; total: number }): number =>
  total === 0 ? 0 : caught === total ? 100 : Math.min(99, Math.round((caught / total) * 100))

/**
 * The percentage to show: one decimal under 10% (2 of 1025 is "0.2", not "0"), whole numbers from
 * there, and never "100" before the last one.
 */
export function percentText({ caught, total }: { caught: number; total: number }): string {
  if (caught === 0 || total === 0) return '0'
  const tenths = Math.round((caught / total) * 1000) / 10
  return tenths < 10 ? tenths.toFixed(1) : String(percent({ caught, total }))
}

/** The tiles grouped by generation, in order, leaving out generations with none. */
export function byGeneration(
  tiles: readonly DexTile[]
): { gen: (typeof GENERATIONS)[number]; tiles: DexTile[] }[] {
  return GENERATIONS.map((gen) => ({
    gen,
    tiles: tiles.filter((t) => t.dexNo >= gen.first && t.dexNo <= gen.last)
  })).filter((g) => g.tiles.length > 0)
}
