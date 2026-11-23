import { describe, expect, it } from 'vitest'
import { checkDeckFields, DeckFieldError } from '../../../src/shared/decks/fields'
import { decksAvailable } from '../../../src/shared/decks/formats'

const base = {
  format: 'advanced',
  name: 'Snake-Eye',
  notes: '',
  cover: null,
  private: false,
  cards: [{ section: 'main', card: 14558127, qty: 3 }]
}
const bad = (patch: Record<string, unknown>, game: 'ygo' | 'pkm' = 'ygo') =>
  expect(() => checkDeckFields({ ...base, ...patch }, game)).toThrow(DeckFieldError)

describe('checkDeckFields', () => {
  it('accepts a full Yu-Gi-Oh! deck and trims the name', () => {
    expect(checkDeckFields({ ...base, name: '  Snake-Eye  ' }, 'ygo').name).toBe('Snake-Eye')
  })

  it('merges repeated entries for the same section, card and printing', () => {
    const one = { section: 'main', card: 14558127, qty: 1 }
    const r = checkDeckFields({ ...base, cards: [one, one] }, 'ygo')
    expect(r.cards).toEqual([{ section: 'main', card: 14558127, qty: 2 }])
    const s = checkDeckFields({ ...base, cards: [one, { ...one, printing: 'a|b' }] }, 'ygo')
    expect(s.cards).toHaveLength(2)
  })

  it('an empty printing is no pin and merges with the unpinned entry', () => {
    const one = { section: 'main', card: 14558127, qty: 1 }
    const r = checkDeckFields({ ...base, cards: [one, { ...one, printing: '' }] }, 'ygo')
    expect(r.cards).toEqual([{ section: 'main', card: 14558127, qty: 2 }])
  })

  it('rejects bad fields', () => {
    bad({ name: '' })
    bad({ name: 'x'.repeat(81) })
    bad({ notes: 'x'.repeat(2001) })
    bad({ format: 'goat' })
    bad({}, 'pkm')
    bad({ cards: [{ section: 'pendulum', card: 1, qty: 1 }] })
    for (const qty of [0, 100, 1.5]) bad({ cards: [{ section: 'main', card: 1, qty }] })
    bad({ cards: [{ section: 'main', card: -1, qty: 1 }] })
    bad({
      cards: Array.from({ length: 301 }, (_, i) => ({ section: 'main', card: i, qty: 1 }))
    })
    bad({ cards: [{ section: 'main', card: 1, qty: 1, printing: 5 }] })
    bad({ cards: [{ section: 'main', card: 1, qty: 1, printing: 'x'.repeat(65) }] })
  })

  it('keeps an entry whose card is unknown to this catalog', () => {
    const r = checkDeckFields(
      { ...base, cards: [{ section: 'main', card: 99999999, qty: 1 }] },
      'ygo'
    )
    expect(r.cards[0].card).toBe(99999999)
  })

  it('decksAvailable is true for ygo, pkm and op', () => {
    expect(decksAvailable('ygo')).toBe(true)
    expect(decksAvailable('pkm')).toBe(true)
    expect(decksAvailable('op')).toBe(true)
    expect(decksAvailable('mtg')).toBe(false)
  })
})
