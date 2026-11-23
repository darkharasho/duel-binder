import { describe, expect, it } from 'vitest'
import { DECK_FORMATS, decksAvailable, defaultSection } from '../../../src/shared/decks/formats'
import type { DeckCard } from '../../../src/shared/decks/types'

const c = (frameType: string): DeckCard => ({
  id: 1,
  name: 'Card',
  type: 'Monster',
  frameType,
  imageId: null,
  owned: 0,
  price: null,
  regionPrice: null,
  sourceId: null,
  code: null,
  opNumber: null,
  opCardType: null,
  opColors: [],
  opCost: null,
  opBlock: null
})

describe('defaultSection', () => {
  it('puts every Extra Deck frame in Extra', () => {
    for (const f of [
      'fusion',
      'synchro',
      'xyz',
      'link',
      'fusion_pendulum',
      'synchro_pendulum',
      'xyz_pendulum'
    ])
      expect(defaultSection('ygo', c(f))).toBe('extra')
  })
  it('puts everything else, and an unknown card, in Main', () => {
    for (const f of ['effect', 'normal', 'ritual', 'effect_pendulum', 'spell', 'trap', 'token'])
      expect(defaultSection('ygo', c(f))).toBe('main')
    expect(defaultSection('ygo', undefined)).toBe('main')
  })
})

describe('pkm formats', () => {
  it('has Standard and Expanded with one 60-card section', () => {
    expect(DECK_FORMATS.pkm.map((f) => f.id)).toEqual(['standard', 'expanded'])
    for (const f of DECK_FORMATS.pkm)
      expect(f.sections).toEqual([{ id: 'main', label: 'Deck', min: 60, max: 60 }])
    expect(decksAvailable('pkm')).toBe(true)
  })
})

describe('op formats', () => {
  it('has Standard and Extra Regulation with a Leader and a 50-card Deck, in that order', () => {
    expect(DECK_FORMATS.op.map((f) => [f.id, f.label, f.priceRegion])).toEqual([
      ['standard', 'Standard', 'en'],
      ['extra', 'Extra Regulation', 'en']
    ])
    for (const f of DECK_FORMATS.op)
      expect(f.sections).toEqual([
        { id: 'leader', label: 'Leader', min: 1, max: 1 },
        { id: 'main', label: 'Deck', min: 50, max: 50 }
      ])
    expect(decksAvailable('op')).toBe(true)
  })
  it('puts a Leader in Leader and a Character in the Deck', () => {
    expect(defaultSection('op', { frameType: 'op', opCardType: 'Leader' })).toBe('leader')
    expect(defaultSection('op', { frameType: 'op', opCardType: 'Character' })).toBe('main')
  })
})
