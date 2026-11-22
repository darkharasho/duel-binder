import type { DeckCard, DeckEntry } from './types'

export interface DeckCost {
  /** Priced missing copies, in dollars. */
  total: number
  /** Missing copies that have no price. */
  unpricedCopies: number
  missing: { card: number; copies: number; unit: number | null }[]
}

/**
 * What finishing a deck costs: each card's copies needed (summed over Main, Extra and Side) less
 * the copies owned, at the format's price column. A card absent from `cards` counts as unowned and unpriced.
 */
export function deckCost(
  entries: DeckEntry[],
  cards: Record<number, DeckCard>,
  priceRegion: 'en' | 'asia'
): DeckCost {
  const needed = new Map<number, number>()
  for (const e of entries) needed.set(e.card, (needed.get(e.card) ?? 0) + e.qty)
  const out: DeckCost = { total: 0, unpricedCopies: 0, missing: [] }
  for (const [id, n] of needed) {
    const c = cards[id]
    const copies = Math.max(0, n - (c?.owned ?? 0))
    if (copies === 0) continue
    const unit = (priceRegion === 'asia' ? c?.regionPrice : c?.price) ?? null
    out.missing.push({ card: id, copies, unit })
    if (unit === null) out.unpricedCopies += copies
    else out.total += copies * unit
  }
  return out
}
