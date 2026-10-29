import type { ScanDraft } from '@shared/scan/types'
import type { ScanRow } from './session'

/** The scanner's frosted glass: cards, chips and buttons over the blurred camera. */
export const GLASS = 'border border-white/[0.13] bg-white/[0.07] backdrop-blur-xl'

/**
 * A Pokémon card whose version the scanner couldn't tell: its printing is only a placeholder (the
 * cheapest version), so it has no price of its own and waits for its version to be picked.
 */
export const versionToPick = (d: Pick<ScanDraft, 'game' | 'flag'>): boolean =>
  d.game === 'pkm' && d.flag === 'pick-printing'

/** The row's printing, or null while it has none (none matched, or a version still to pick). */
export const printingOf = (row: Pick<ScanDraft, 'game' | 'flag' | 'printingId'>): number | null =>
  versionToPick(row) ? null : row.printingId

/** Rows saved before prices existed have no `price` key at all. */
export const priceOf = (row: ScanRow): number | null | undefined => {
  const printingId = printingOf(row)
  return printingId === null
    ? undefined
    : row.options.find((o) => o.printingId === printingId)?.price
}

/** The lowest and highest of the card's option prices, when they differ; for a version or printing still to pick. */
export function priceRange(
  row: Pick<ScanDraft, 'cardId' | 'options'>
): { low: number; high: number } | null {
  const prices = row.options.flatMap((o) =>
    o.cardId === row.cardId && o.price != null ? [o.price] : []
  )
  if (!prices.length) return null
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  return low === high ? null : { low, high }
}

/**
 * A scan list's value: the sum over rows with a price, and how many copies have none. Unpriced copies
 * are left out of `value`, never counted as $0, so the list can say so.
 */
export function listValue(rows: ScanRow[]): { value: number; priced: number; unpriced: number } {
  let value = 0
  let priced = 0
  let unpriced = 0
  for (const r of rows) {
    const p = priceOf(r)
    if (p == null) unpriced += r.quantity
    else {
      value += p * r.quantity
      priced++
    }
  }
  return { value, priced, unpriced }
}
