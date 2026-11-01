import type { ScanSummary } from '@shared/scanWindow'
import { listValue, priceOf } from '../scanLook'
import type { ScanRow } from '../session'

const TOP = 5

/**
 * The list as the summary screen shows it. Value and unpriced copies are the Review list's own, so
 * the two never disagree. A best guess counts towards the value as it does there, but like a pull
 * it is never a hit: a hit is a card known to be in hand.
 */
export function sessionSummary(rows: ScanRow[], hitPrice: number): ScanSummary {
  const priced = rows.flatMap((r) => {
    const price = priceOf(r)
    return price == null ? [] : [{ row: r, price }]
  })
  const { value, unpriced } = listValue(rows)
  return {
    value,
    unpriced,
    cards: rows.reduce((n, r) => n + r.quantity, 0),
    hits: priced.reduce(
      (n, { row, price }) => n + (!row.guess && price >= hitPrice ? row.quantity : 0),
      0
    ),
    top: [...priced]
      .sort((a, b) => b.price - a.price)
      .slice(0, TOP)
      .map(({ row, price }) => ({
        key: row.key,
        name: row.name,
        imageId: row.imageId,
        price,
        raw: row.slab === true,
        guess: row.guess === true
      }))
  }
}
