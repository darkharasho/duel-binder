import { describe, expect, it } from 'vitest'
import {
  describeLayout,
  layoutFor,
  RIP_LAYOUTS,
  RIP_SET_LAYOUTS
} from '../../src/shared/rip/layouts'
import { canFill, mulberry32, rollPack } from '../../src/shared/rip/roll'
import type { PackLayout, PoolCard } from '../../src/shared/rip/types'

const layout: PackLayout = {
  id: 't',
  label: 't',
  source: 'test',
  slots: [
    { count: 7, picks: [{ rarity: 'Common', weight: 1 }] },
    { count: 1, picks: [{ rarity: 'Rare', weight: 1 }] },
    {
      count: 1,
      picks: [
        { rarity: 'Super Rare', weight: 3 },
        { rarity: 'Ultra Rare', weight: 2 },
        { rarity: 'Secret Rare', weight: 1 }
      ]
    }
  ]
}

let nextId = 1
function card(rarity: string, cardId = nextId++, variant: string | null = null): PoolCard {
  return {
    pkey: `en|${cardId}|TST-EN${cardId}|${rarity}|${variant ?? ''}`,
    cardId,
    name: `Card ${cardId}`,
    setCode: `TST-EN${String(cardId).padStart(3, '0')}`,
    rarity,
    variant,
    frameType: 'effect',
    imageId: cardId
  }
}

function makePool(counts: Record<string, number>): PoolCard[] {
  const out: PoolCard[] = []
  for (const [rarity, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) out.push(card(rarity))
  }
  return out
}

const pool = makePool({ Common: 20, Rare: 5, 'Super Rare': 4, 'Ultra Rare': 3, 'Secret Rare': 2 })

/** Share of each rarity in the last slot over `n` packs. */
function foilShares(p: PoolCard[], n: number): Record<string, number> {
  const rand = mulberry32(12345)
  const tally: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const pack = rollPack(layout, p, rand)
    const r = pack[pack.length - 1].rarity
    tally[r] = (tally[r] ?? 0) + 1
  }
  for (const k of Object.keys(tally)) tally[k] /= n
  return tally
}

describe('rollPack', () => {
  it('fills every slot in order', () => {
    const pack = rollPack(layout, pool, mulberry32(1))
    expect(pack).toHaveLength(9)
    pack.forEach((c, i) => expect(c.slot).toBe(i))
    for (const c of pack.slice(0, 7)) expect(c.rarity).toBe('Common')
    expect(pack[7].rarity).toBe('Rare')
    expect(['Super Rare', 'Ultra Rare', 'Secret Rare']).toContain(pack[8].rarity)
  })

  it('does not repeat a card within a slot group when there are enough', () => {
    const rand = mulberry32(3)
    for (let i = 0; i < 200; i++) {
      const commons = rollPack(layout, pool, rand).slice(0, 7)
      expect(new Set(commons.map((c) => c.cardId)).size).toBe(7)
    }
  })

  it('does not repeat a card anywhere in a pack when there are enough', () => {
    // core-2010 shape: Commons are split over the fixed group, the SP slot and the foil-or-Common slot.
    const l = RIP_LAYOUTS['core-2010']
    const p = makePool({
      Common: 60,
      'Short Print': 4,
      Rare: 20,
      'Super Rare': 10,
      'Ultra Rare': 8,
      'Ultimate Rare': 8,
      'Secret Rare': 6,
      'Ghost Rare': 1
    })
    const rand = mulberry32(11)
    for (let i = 0; i < 2000; i++) {
      const pack = rollPack(l, p, rand)
      expect(new Set(pack.map((c) => c.cardId)).size).toBe(pack.length)
    }
  })

  it('allows repeats when a rarity is too small', () => {
    const small = makePool({ Common: 2, Rare: 1, 'Super Rare': 1 })
    const pack = rollPack(layout, small, mulberry32(5))
    expect(pack).toHaveLength(9)
    for (const c of pack.slice(0, 7)) expect(c.rarity).toBe('Common')
  })

  it('is deterministic for a seed', () => {
    expect(rollPack(layout, pool, mulberry32(7))).toEqual(rollPack(layout, pool, mulberry32(7)))
  })

  it('foil odds match weights over 60k packs', () => {
    const s = foilShares(pool, 60_000)
    expect(Math.abs(s['Secret Rare'] - 1 / 6)).toBeLessThan(0.01)
    expect(Math.abs(s['Ultra Rare'] - 2 / 6)).toBeLessThan(0.01)
    expect(Math.abs(s['Super Rare'] - 3 / 6)).toBeLessThan(0.01)
  })

  it('missing rarity folds into base', () => {
    const noSecret = pool.filter((c) => c.rarity !== 'Secret Rare')
    expect(rollPack(layout, noSecret, mulberry32(9))).toHaveLength(9)
    const s = foilShares(noSecret, 20_000)
    expect(s['Secret Rare']).toBeUndefined()
    expect(Math.abs(s['Super Rare'] - 4 / 6)).toBeLessThan(0.015)
  })

  it('matches printings by base rarity, keeping the variant label', () => {
    const p = [
      ...makePool({ Common: 10, Rare: 2, 'Super Rare': 2 }),
      card('Ultra Rare (Overframe)')
    ]
    const only = { ...layout, slots: [{ count: 1, picks: [{ rarity: 'Ultra Rare', weight: 1 }] }] }
    expect(canFill(only, p)).toBe(true)
    expect(rollPack(only, p, mulberry32(2))[0].rarity).toBe('Ultra Rare (Overframe)')
  })

  it('alternate arts do not double a card', () => {
    const a1 = card('Secret Rare', 9001)
    const a2 = card('Secret Rare', 9001, 'Alternate Art')
    const b = card('Secret Rare', 9002)
    const p = [...makePool({ Common: 10, Rare: 2 }), a1, a2, b]
    const only: PackLayout = {
      ...layout,
      slots: [{ count: 1, picks: [{ rarity: 'Secret Rare', weight: 1 }] }]
    }
    const rand = mulberry32(42)
    let a = 0
    let alt = 0
    const n = 20_000
    for (let i = 0; i < n; i++) {
      const c = rollPack(only, p, rand)[0]
      if (c.cardId === 9001) {
        a++
        if (c.variant) alt++
      }
    }
    expect(Math.abs(a / n - 0.5)).toBeLessThan(0.015)
    expect(Math.abs(alt / a - 0.5)).toBeLessThan(0.02)
  })
})

describe('canFill', () => {
  it('is true when every base rarity has a card', () => {
    expect(canFill(layout, pool)).toBe(true)
  })

  it('is false when a base rarity is missing', () => {
    expect(
      canFill(
        layout,
        pool.filter((c) => c.rarity !== 'Rare')
      )
    ).toBe(false)
  })
})

describe('mulberry32', () => {
  it('yields numbers in [0, 1)', () => {
    const r = mulberry32(99)
    for (let i = 0; i < 1000; i++) {
      const x = r()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('layouts', () => {
  it('Super Short Prints are no likelier per card than Short Prints', () => {
    // LOB shape: 15 Short Print cards, 2 Super Short Print cards.
    const l = RIP_LAYOUTS['core-2002']
    const p = makePool({
      Common: 60,
      'Short Print': 15,
      'Super Short Print': 2,
      Rare: 20,
      'Super Rare': 10,
      'Ultra Rare': 10,
      'Secret Rare': 2
    })
    const rand = mulberry32(21)
    let sp = 0
    let ssp = 0
    for (let i = 0; i < 20_000; i++) {
      for (const c of rollPack(l, p, rand)) {
        if (c.rarity === 'Short Print') sp++
        if (c.rarity === 'Super Short Print') ssp++
      }
    }
    expect(ssp).toBeGreaterThan(0)
    expect(ssp / 2).toBeLessThanOrEqual(sp / 15)
    // Same check from the weights, for the most lopsided early set in the catalog (AST: 21 SP, 1 SSP).
    const picks = l.slots.flatMap((s) => s.picks)
    const w = (r: string): number => picks.find((x) => x.rarity === r)!.weight
    expect(w('Super Short Print') / 1).toBeLessThanOrEqual(w('Short Print') / 21)
  })

  it('every researched layout is sane', () => {
    for (const [id, l] of Object.entries(RIP_LAYOUTS)) {
      expect(l.id).toBe(id)
      expect(l.source).not.toBe('')
      expect(l.label).not.toBe('')
      expect(l.slots.length).toBeGreaterThan(0)
      for (const s of l.slots) {
        expect(s.count).toBeGreaterThan(0)
        expect(s.picks.length).toBeGreaterThan(0)
        for (const p of s.picks) expect(p.weight).toBeGreaterThan(0)
      }
    }
    for (const id of Object.values(RIP_SET_LAYOUTS)) expect(RIP_LAYOUTS[id]).toBeDefined()
  })

  it('known sets map to layouts', () => {
    for (const code of ['LOB', 'IOC', 'CBLZ', 'PHNI', 'ROTA'])
      expect(layoutFor(code)).not.toBeNull()
    expect(layoutFor('SBCB')).toBeNull()
    expect(layoutFor('SS01')).toBeNull()
  })

  it('accepts a full card code or an injected map', () => {
    expect(layoutFor('LOB-EN001')).toBe(layoutFor('LOB'))
    expect(layoutFor('lob')).toBe(layoutFor('LOB'))
    const id = Object.keys(RIP_LAYOUTS)[0]
    expect(layoutFor('ZZZZ', { ZZZZ: id })).toBe(RIP_LAYOUTS[id])
    expect(layoutFor('LOB', {})).toBeNull()
  })
})

describe('describeLayout', () => {
  const lines: Record<string, string> = {
    'core-2002': '9 cards a pack · 1 Rare or better',
    'core-2004': '9 cards a pack · 1 Rare or better',
    'core-2007': '9 cards a pack · 1 Rare or better',
    'core-2008': '9 cards a pack · 1 Rare + 1 slot that can hit Super or better',
    'core-2010': '9 cards a pack · 1 Rare + 1 slot that can hit Super or better',
    'core-2016': '9 cards a pack · 1 Rare + 1 Super or better',
    'core-2020': '9 cards a pack · 1 Super or better',
    'core-2023': '9 cards a pack · 1 Super or better',
    'core-2025': '9 cards a pack · 1 Super or better'
  }
  it('has an expected line for every layout', () => {
    expect(Object.keys(lines).sort()).toEqual(Object.keys(RIP_LAYOUTS).sort())
  })
  for (const [id, line] of Object.entries(lines)) {
    it(`describes ${id}`, () => expect(describeLayout(RIP_LAYOUTS[id])).toBe(line))
  }
  it('lists a fixed non-Common slot and skips Short Print upgrades', () => {
    expect(
      describeLayout({
        id: 't',
        label: 't',
        source: 't',
        slots: [
          { count: 7, picks: [{ rarity: 'Common', weight: 1 }] },
          {
            count: 1,
            picks: [
              { rarity: 'Common', weight: 2 },
              { rarity: 'Short Print', weight: 1 }
            ]
          },
          { count: 2, picks: [{ rarity: 'Ultra Rare', weight: 1 }] }
        ]
      })
    ).toBe('10 cards a pack · 2 Ultra')
  })
})
