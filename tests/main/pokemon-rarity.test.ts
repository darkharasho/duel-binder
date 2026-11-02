import { describe, it, expect } from 'vitest'
import { pokemonRarity } from '../../scripts/catalog/pokemon/rarity'

describe('pokemonRarity', () => {
  it('gives every word title case', () => {
    expect(pokemonRarity('Triple rare')).toBe('Triple Rare')
    expect(pokemonRarity('Special illustration rare')).toBe('Special Illustration Rare')
    expect(pokemonRarity('Character super rare')).toBe('Character Super Rare')
    expect(pokemonRarity('Prism Star rare')).toBe('Prism Star Rare')
  })

  it('keeps the upper case tokens', () => {
    expect(pokemonRarity('ACE SPEC rare')).toBe('ACE SPEC Rare')
    expect(pokemonRarity('Shiny rare VMAX')).toBe('Shiny Rare VMAX')
    expect(pokemonRarity('Holo Rare VSTAR')).toBe('Holo Rare VSTAR')
    expect(pokemonRarity('Rare PRIME')).toBe('Rare PRIME')
    expect(pokemonRarity('LEGEND')).toBe('LEGEND')
    expect(pokemonRarity('RGB Rare')).toBe('RGB Rare')
  })

  it('reads Rare Holo as Holo Rare', () => {
    expect(pokemonRarity('Rare Holo')).toBe('Holo Rare')
    expect(pokemonRarity('Rare Holo LV.X')).toBe('Holo Rare LV.X')
    expect(pokemonRarity('Holo Rare')).toBe('Holo Rare')
  })

  it('reads None, empty and missing as no rarity', () => {
    expect(pokemonRarity('None')).toBeNull()
    expect(pokemonRarity('')).toBeNull()
    expect(pokemonRarity('  ')).toBeNull()
    expect(pokemonRarity(null)).toBeNull()
    expect(pokemonRarity(undefined)).toBeNull()
  })

  it('trims and collapses spaces', () => {
    expect(pokemonRarity(' Double  rare ')).toBe('Double Rare')
  })
})
