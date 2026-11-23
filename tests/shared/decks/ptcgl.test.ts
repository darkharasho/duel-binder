import { describe, expect, it } from 'vitest'
import { parsePtcgl, toPtcgl } from '../../../src/shared/decks/pokemon/ptcgl'
import type { DeckCard, DeckEntry } from '../../../src/shared/decks/types'

const card = (id: number, name: string, type: string, code: string | null): DeckCard => ({
  id,
  name,
  type,
  frameType: '',
  imageId: null,
  owned: 0,
  price: null,
  regionPrice: null,
  sourceId: null,
  code
})

describe('parsePtcgl', () => {
  it('reads set and number', () => {
    const p = parsePtcgl('4 Pikachu ex SVI 057')
    expect(p.sectioned).toBe(false)
    expect(p.lines).toHaveLength(1)
    expect(p.lines[0]).toMatchObject({
      qty: 4,
      section: 'main',
      ref: { set: 'SVI', number: '057', name: 'Pikachu ex' }
    })
  })

  it('ignores headers and blank lines', () => {
    const p = parsePtcgl(
      'Pokémon: 4\n4 Pikachu ex SVI 057\n\nTrainer: 36\nPokemon: 1\nEnergy: 12\nTotal Cards: 60\n'
    )
    expect(p.lines).toHaveLength(1)
    expect(p.skipped).toEqual([])
  })

  it('normalizes basic Energy and keeps real sets', () => {
    for (const l of ['2 Basic {R} Energy SVE 2', '2 Fire Energy SVE 2'])
      expect(parsePtcgl(l).lines[0]).toMatchObject({
        qty: 2,
        ref: { set: 'SVE', number: '2', name: 'Fire Energy' }
      })
    expect(parsePtcgl('2 Basic Fire Energy Energy 2').lines[0]).toMatchObject({
      qty: 2,
      ref: { name: 'Fire Energy' }
    })
    expect(parsePtcgl('3 Basic {G} Energy').lines[0].ref).toEqual({ name: 'Grass Energy' })
  })

  it('skips garbage', () => {
    const p = parsePtcgl('garbage')
    expect(p.lines).toEqual([])
    expect(p.skipped).toEqual([{ line: 1, raw: 'garbage' }])
  })
})

describe('toPtcgl', () => {
  it('round trips under headers', () => {
    const cards = {
      1: card(1, 'Pikachu ex', 'Pokémon', 'SVI 057/198'),
      2: card(2, 'Iono', 'Trainer', 'PAL 185/193'),
      3: card(3, 'Fire Energy', 'Energy', null)
    }
    const entries: DeckEntry[] = [
      { section: 'main', card: 3, qty: 5 },
      { section: 'main', card: 2, qty: 4 },
      { section: 'main', card: 1, qty: 2 }
    ]
    const text = toPtcgl(entries, cards)
    expect(text).toBe(
      'Pokémon: 2\n2 Pikachu ex SVI 57\n\nTrainer: 4\n4 Iono PAL 185\n\nEnergy: 5\n5 Fire Energy\n\nTotal Cards: 11'
    )
    const back = parsePtcgl(text)
    expect(back.skipped).toEqual([])
    expect(back.lines.map((l) => [l.qty, l.ref])).toEqual([
      [2, { set: 'SVI', number: '57', name: 'Pikachu ex' }],
      [4, { set: 'PAL', number: '185', name: 'Iono' }],
      [5, { name: 'Fire Energy' }]
    ])
  })

  it('exports a card missing from the map as its id', () => {
    const text = toPtcgl(
      [
        { section: 'main', card: 1, qty: 2 },
        { section: 'main', card: 77, qty: 3 }
      ],
      { 1: card(1, 'Pikachu ex', 'Pokémon', 'SVI 057/198') }
    )
    expect(text).toBe('Pokémon: 5\n2 Pikachu ex SVI 57\n3 #77\n\nTotal Cards: 5')
  })
})
