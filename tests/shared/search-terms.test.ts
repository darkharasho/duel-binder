import { describe, expect, it } from 'vitest'
import { confineTarget, termKey, termWords } from '../../src/shared/search/terms'

describe('termKey / termWords', () => {
  it('folds case, accents and punctuation', () => {
    expect(termKey('Blue-Eyes')).toBe('blue eyes')
    expect(termKey('  BLUE   EYES ')).toBe('blue eyes')
    expect(termKey('Ash Blossom & Joyous Spring')).toBe('ash blossom and joyous spring')
    expect(termKey('Flabébé')).toBe('flabebe')
    expect(termKey('Pokémon')).toBe('pokemon')
    expect(termKey('232/091')).toBe('232 091')
    expect(termWords('Bubble Mew!')).toEqual(['bubble', 'mew'])
    expect(termKey('!!!')).toBe('')
    expect(termKey('ガブリエル')).toBe('ガブリエル')
    expect(termKey('R&D')).toBe('r and d')
    expect(termWords('')).toEqual([])
  })
})

describe('confineTarget', () => {
  it("keeps only the target kind's list", () => {
    const t = {
      pkeys: ['p'],
      cardIds: [1],
      sets: [{ language: 'en', setName: 'S' }],
      rarities: ['R']
    }
    expect(confineTarget('printing', t)).toEqual({ pkeys: ['p'] })
    expect(confineTarget('card', t)).toEqual({ cardIds: [1] })
    expect(confineTarget('cards', t)).toEqual({ cardIds: [1] })
    expect(confineTarget('set', t)).toEqual({ sets: [{ language: 'en', setName: 'S' }] })
    expect(confineTarget('rarity', t)).toEqual({ rarities: ['R'] })
    expect(confineTarget('card', { pkeys: ['p'], cardIds: [] })).toEqual({})
  })
})
