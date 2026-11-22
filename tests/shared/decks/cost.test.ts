import { describe, expect, it } from 'vitest'
import { deckCost } from '../../../src/shared/decks/cost'
import type { DeckCard, DeckEntry } from '../../../src/shared/decks/types'

const c = (
  id: number,
  owned: number,
  price: number | null,
  regionPrice: number | null
): DeckCard => ({
  id,
  name: `C${id}`,
  type: '',
  frameType: 'effect',
  imageId: null,
  owned,
  price,
  regionPrice
})
const cards = { 1: c(1, 1, 2, 5), 2: c(2, 0, null, null), 3: c(3, 9, 1, 1) }
const e = (section: DeckEntry['section'], card: number, qty: number): DeckEntry => ({
  section,
  card,
  qty
})

describe('deckCost', () => {
  it('counts needed across sections against owned, and tallies unpriced copies', () => {
    const r = deckCost(
      [e('main', 1, 2), e('side', 1, 1), e('main', 2, 2), e('main', 3, 3)],
      cards,
      'en'
    )
    expect(r.total).toBe(4)
    expect(r.unpricedCopies).toBe(2)
    expect(r.missing).toEqual([
      { card: 1, copies: 2, unit: 2 },
      { card: 2, copies: 2, unit: null }
    ])
  })
  it('uses the region price for asia', () => {
    expect(deckCost([e('main', 1, 2)], cards, 'asia').total).toBe(5)
  })
  it('treats a card absent from the map as unpriced and unowned', () => {
    const r = deckCost([e('main', 99, 1)], cards, 'en')
    expect(r.unpricedCopies).toBe(1)
    expect(r.total).toBe(0)
  })
})
