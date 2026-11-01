import type { ScanSummary, ScanSummaryCard } from '@shared/scanWindow'
import { listValue, priceOf } from '../scanLook'
import type { ScanRow } from '../session'

const card = (row: ScanRow): ScanSummaryCard => ({
  key: row.key,
  name: row.name,
  imageId: row.imageId,
  detail: [row.setCode, row.rarity].filter(Boolean).join(' · '),
  quantity: row.quantity,
  price: priceOf(row) ?? null,
  raw: row.slab === true,
  guess: row.guess === true
})

/**
 * The list as the summary screen shows it. Value and unpriced copies are the Review list's own, so
 * the two never disagree. A best guess counts towards the value as it does there, but like a pull
 * it is never a hit: a hit is a card known to be in hand.
 */
export function sessionSummary(rows: ScanRow[], hitPrice: number): ScanSummary {
  const { value, unpriced } = listValue(rows)
  const list = rows.map(card).sort((a, b) => (b.price ?? -1) - (a.price ?? -1))
  return {
    value,
    unpriced,
    cards: rows.reduce((n, r) => n + r.quantity, 0),
    hits: list.reduce(
      (n, c) => n + (!c.guess && c.price != null && c.price >= hitPrice ? c.quantity : 0),
      0
    ),
    hit: list.find((c) => !c.guess && c.price != null) ?? null,
    list
  }
}
