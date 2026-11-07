import { describe, expect, it } from 'vitest'
import {
  GENERATIONS,
  POKEDEX_SIZE,
  SPECIES,
  generationOf,
  speciesName
} from '../../src/shared/pokedex'

describe('pokedex species', () => {
  it('has every species', () => {
    expect(POKEDEX_SIZE).toBe(1025)
    expect(SPECIES.length).toBe(1025)
    expect(SPECIES[0]).toBe('Bulbasaur')
  })

  it('names species by dex number', () => {
    expect(speciesName(6)).toBe('Charizard')
    expect(speciesName(122)).toBe('Mr. Mime')
    expect(speciesName(29)).toBe('Nidoran♀')
    expect(speciesName(83)).toBe("Farfetch'd")
    expect(speciesName(865)).toBe("Sirfetch'd")
    expect(speciesName(1025)).toBe('Pecharunt')
    expect(speciesName(0)).toBeNull()
    expect(speciesName(1026)).toBeNull()
  })

  it('generations cover 1..1025 contiguously', () => {
    let next = 1
    for (const g of GENERATIONS) {
      expect(g.first).toBe(next)
      next = g.last + 1
    }
    expect(next).toBe(1026)
  })

  it('finds the generation of a species', () => {
    expect(generationOf(152)).toBe(2)
    expect(generationOf(906)).toBe(9)
    expect(generationOf(0)).toBeNull()
    expect(generationOf(1026)).toBeNull()
  })
})
