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
  regionPrice: null
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
