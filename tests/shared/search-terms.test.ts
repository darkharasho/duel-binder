import { describe, expect, it } from 'vitest'
import { termKey, termWords } from '../../src/shared/search/terms'

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
