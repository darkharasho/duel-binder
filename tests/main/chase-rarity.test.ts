import { describe, expect, it } from 'vitest'
import { chaseTier } from '../../src/shared/chaseRarity'

describe('chaseTier', () => {
  it("Yu-Gi-Oh!: Starlight and overframes top, Secret Rares chase, Ultra Rares don't", () => {
    expect(chaseTier('ygo', 'Starlight Rare')).toBe(2)
    expect(chaseTier('ygo', 'Ultra Rare (Overframe)')).toBe(2)
    expect(chaseTier('ygo', 'Quarter Century Secret Rare')).toBe(2)
    expect(chaseTier('ygo', 'Secret Rare')).toBe(1)
    expect(chaseTier(undefined, 'Ultimate Rare')).toBe(1)
    expect(chaseTier('ygo', 'Ultra Rare')).toBe(0)
    expect(chaseTier('ygo', 'Super Rare')).toBe(0)
    expect(chaseTier('ygo', null)).toBe(0)
  })

  it('Pokémon: Ultra Rares and ex cards chase, Special Illustration Rares top, plain ones not', () => {
    expect(chaseTier('pkm', 'Special Illustration Rare')).toBe(2)
    expect(chaseTier('pkm', 'Hyper Rare')).toBe(2)
    expect(chaseTier('pkm', 'Ultra Rare')).toBe(1)
    expect(chaseTier('pkm', 'Double Rare')).toBe(1)
    expect(chaseTier('pkm', 'Holo Rare', 'Charizard ex')).toBe(1)
    expect(chaseTier('pkm', 'Holo Rare', 'Pikachu V')).toBe(1)
    expect(chaseTier('pkm', 'Holo Rare', 'Charizard')).toBe(0)
    expect(chaseTier('pkm', 'Common', 'Hoothoot')).toBe(0)
    expect(chaseTier('pkm', null, 'Exeggcute')).toBe(0)
  })

  it('One Piece: SEC, SP and TR top, SR and alternate arts chase', () => {
    expect(chaseTier('op', 'SEC')).toBe(2)
    expect(chaseTier('op', 'SR')).toBe(1)
    expect(chaseTier('op', 'R (Alternate Art)')).toBe(1)
    expect(chaseTier('op', 'R')).toBe(0)
  })
})
