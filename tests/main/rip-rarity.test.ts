import { describe, expect, it } from 'vitest'
import {
  artBox,
  canonicalRarity,
  compareRarity,
  holoKind,
  isStarlight,
  nameBox,
  nameInk,
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

  it('places the Gold Series rarities: Gold Secret above Secret, Ghost/Gold above Ghost', () => {
    expect(ripRank('Gold Secret Rare')).toBeGreaterThan(ripRank('Secret Rare'))
    expect(ripRank('Gold Secret Rare')).toBeGreaterThan(ripRank('Premium Gold Rare'))
    expect(ripRank('Ghost/Gold Rare')).toBeGreaterThan(ripRank('Ghost Rare'))
    expect(ripRank('Ghost/Gold Rare')).toBeGreaterThan(ripRank('Gold Rare'))
  })

  it('lists the tiers lowest to highest', () => {
    expect(RIP_TIERS[0]).toBe('Common')
    expect(RIP_TIERS[RIP_TIERS.length - 1]).toBe('10000 Secret Rare')
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
    expect(holoKind('Super Rare', null)).toBe('soft')
    expect(holoKind('Ultra Rare', null)).toBe('soft')
    expect(holoKind('Ghost Rare', null)).toBe('soft')
    expect(holoKind('Gold Secret Rare', null)).toBe('art')
    expect(holoKind('Ghost/Gold Rare', null)).toBe('soft')
    expect(holoKind('Rare', null)).toBe('none')
    expect(holoKind('Common', null)).toBe('none')
  })

  it('treats an Overframe in the rarity text as full holo', () => {
    expect(holoKind('Secret Rare (Overframe)', null)).toBe('full')
  })
})

describe('artBox', () => {
  it('art box differs for pendulums', () => {
    expect(artBox('effect_pendulum')).toEqual({ left: 6.4, top: 17.9, right: 6.4, bottom: 38.0 })
    expect(artBox('effect')).toEqual({ left: 11.9, top: 18.1, right: 11.9, bottom: 29.6 })
    expect(artBox('effect_pendulum')).not.toEqual(artBox('effect'))
  })
})

describe('nameBox and nameInk', () => {
  it('the name strip sits at the top, clear of the attribute icon', () => {
    const b = nameBox()
    expect(b.top).toBeLessThan(5)
    expect(b.bottom).toBeGreaterThan(85)
    expect(b.right).toBeGreaterThan(b.left)
  })

  it('white names on Xyz, Link, Spell and Trap frames, black on the rest', () => {
    expect(nameInk('xyz')).toBe('light')
    expect(nameInk('xyz_pendulum')).toBe('light')
    expect(nameInk('link')).toBe('light')
    expect(nameInk('spell')).toBe('light')
    expect(nameInk('trap')).toBe('light')
    expect(nameInk('synchro')).toBe('dark')
    expect(nameInk('effect_pendulum')).toBe('dark')
    expect(nameInk('fusion')).toBe('dark')
  })
})

describe('isStarlight', () => {
  it('only Starlight, with or without a variant', () => {
    expect(isStarlight('Starlight Rare')).toBe(true)
    expect(isStarlight('Starlight Rare (Alternate Art)')).toBe(true)
    expect(isStarlight('Secret Rare')).toBe(false)
    expect(isStarlight('Starfoil Rare')).toBe(false)
  })
})

describe('canonicalRarity', () => {
  it("fixes a known rarity's capitalisation and keeps its variant", () => {
    expect(canonicalRarity('PLatinum Secret Rare')).toBe('Platinum Secret Rare')
    expect(canonicalRarity('ultra rare (Stamp)')).toBe('Ultra Rare (Stamp)')
    expect(canonicalRarity('Secret Rare')).toBe('Secret Rare')
    expect(canonicalRarity('force-SMW')).toBe('force-SMW')
  })
})
