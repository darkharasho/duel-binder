import { describe, expect, it } from 'vitest'
import { defaultSection } from '../../../src/shared/decks/formats'
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
