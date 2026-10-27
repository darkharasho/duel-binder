import { describe, expect, it } from 'vitest'
import {
  artBox,
  compareRarity,
  holoKind,
  revealTier,
  RIP_TIERS,
  ripRank
} from '../../src/shared/rip/rarity'

describe('ripRank', () => {
  it('ranks Starlight top, Common bottom, unknown just above Common', () => {
    expect(compareRarity('Starlight Rare', 'Quarter Century Secret Rare')).toBeLessThan(0)
    expect(ripRank('Platinum Secret Rare')).toBeLessThan(ripRank('Quarter Century Secret Rare'))
    expect(ripRank('Platinum Secret Rare')).toBeGreaterThan(ripRank('Prismatic Secret Rare'))
    expect(ripRank('Ghost Rare')).toBeGreaterThan(ripRank('Ultimate Rare'))
    expect(ripRank('Ultimate Rare')).toBeGreaterThan(ripRank('Secret Rare'))
    expect(ripRank("Collector's Rare")).toBeGreaterThan(ripRank('Secret Rare'))
    expect(ripRank('Mystery Rare')).toBeGreaterThan(ripRank('Common'))
    expect(ripRank('Mystery Rare')).toBeLessThan(ripRank('Short Print'))
    expect(ripRank('Rare (Green)')).toBe(ripRank('Rare'))
  })

  it('strips a trailing variant before looking up the tier', () => {
    expect(ripRank("Ultra Rare (Pharaoh's Rare)")).toBe(ripRank('Ultra Rare'))
    expect(ripRank('Starlight Rare (Overframe)')).toBe(ripRank('Starlight Rare'))
  })

  it('sorts rarest first with compareRarity', () => {
    const sorted = ['Common', 'Secret Rare', 'Starlight Rare', 'Rare'].sort(compareRarity)
    expect(sorted).toEqual(['Starlight Rare', 'Secret Rare', 'Rare', 'Common'])
  })

  it('lists the tiers lowest to highest', () => {
    expect(RIP_TIERS[0]).toBe('Common')
    expect(RIP_TIERS[RIP_TIERS.length - 1]).toBe('Starlight Rare')
  })
})

describe('revealTier', () => {
  it('reveals nothing below Rare and for unknown rarities', () => {
    expect(revealTier('Common')).toBe('none')
    expect(revealTier('Short Print')).toBe('none')
    expect(revealTier('Super Short Print')).toBe('none')
    expect(revealTier('Mystery Rare')).toBe('none')
  })

  it('reveal tiers', () => {
    expect(revealTier('Common')).toBe('none')
    expect(revealTier('Rare')).toBe('rare')
    expect(revealTier('Ultra Rare')).toBe('big')
    expect(revealTier('Secret Rare')).toBe('huge')
    expect(revealTier('Starlight Rare')).toBe('huge')
  })

  it('gives Super through Premium Gold a big reveal', () => {
    expect(revealTier('Super Rare')).toBe('big')
    expect(revealTier('Starfoil Rare')).toBe('big')
    expect(revealTier('Ultra Parallel Rare')).toBe('big')
    expect(revealTier('Gold Rare')).toBe('big')
    expect(revealTier('Premium Gold Rare')).toBe('big')
  })

  it('applies to the base of a variant', () => {
    expect(revealTier('Rare (Green)')).toBe('rare')
    expect(revealTier("Ultra Rare (Pharaoh's Rare)")).toBe('big')
  })
})

describe('holoKind', () => {
  it('holo kinds', () => {
    expect(holoKind('Secret Rare', null)).toBe('art')
    expect(holoKind('Platinum Secret Rare', null)).toBe('art')
    expect(holoKind('Secret Rare', 'Overframe')).toBe('full')
    expect(holoKind('Starlight Rare', null)).toBe('full')
    expect(holoKind('Ultra Rare', null)).toBe('none')
    expect(holoKind('Ghost Rare', null)).toBe('none')
  })

  it('treats an Overframe in the rarity text as full holo', () => {
    expect(holoKind('Secret Rare (Overframe)', null)).toBe('full')
  })
})

describe('artBox', () => {
  it('art box differs for pendulums', () => {
    expect(artBox('effect')).toEqual({ left: 11.9, top: 18.1, right: 11.9, bottom: 29.6 })
    expect(artBox('effect_pendulum')).not.toEqual(artBox('effect'))
  })
})
