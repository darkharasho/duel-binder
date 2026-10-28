import type { ScanRow } from './session'

/** The scanner's frosted glass: cards, chips and buttons over the blurred camera. */
export const GLASS = 'border border-white/[0.13] bg-white/[0.07] backdrop-blur-xl'

/** Rows saved before prices existed have no `price` key at all. */
export const priceOf = (row: ScanRow): number | null | undefined =>
  row.options.find((o) => o.printingId === row.printingId)?.price

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
