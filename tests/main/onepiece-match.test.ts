import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { distance } from '../../scripts/catalog/onepiece/art'
import { matchSeries } from '../../scripts/catalog/onepiece/match'
import type { OpProduct } from '../../scripts/catalog/onepiece/tcgcsv'
import type { BandaiEntry, BandaiSeries } from '../../scripts/catalog/onepiece/types'
import { hashHex } from '../../src/shared/scan/fingerprintRefs'

const bits = (set: number[]): string => {
  const w = new Uint32Array(8)
  for (const b of set) w[b >> 5] |= 1 << (b & 31)
  return hashHex(w)
}
const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i)
const H0 = bits([])
const H1 = bits(range(0, 120))
const H2 = bits(range(120, 240))
const H0near = bits([0, 1])
const H2far = bits(range(140, 240))

const fixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/onepiece/tcgcsv-op17-products.json'), 'utf8'))
interface RawProduct {
  productId: number; groupId: number; name: string; imageUrl: string
  extendedData?: { name: string; value: string }[]
}
const products: OpProduct[] = (fixture.results as RawProduct[]).map((p) => {
  const field = (n: string): string | null => p.extendedData?.find((e) => e.name === n)?.value ?? null
  return { productId: p.productId, groupId: p.groupId, name: p.name, number: field('Number'), rarity: field('Rarity'), imageUrl: p.imageUrl }
})

const entry = (o: Partial<BandaiEntry>): BandaiEntry => ({
  bandaiId: 'OP17-005', number: 'OP17-005', rarity: 'SR', cardType: 'Character', name: 'x', cost: null, life: null,
  power: null, counter: null, colors: [], attribute: [], traits: [], block: null, effect: null, trigger: null,
  cardSets: '', seriesId: '569117', ...o
})
const ser = (id: string, kind: BandaiSeries['kind'], code: string, setCode: string): BandaiSeries =>
  ({ id, kind, title: code, code, setName: code, setCode })
const OP17 = ser('569117', 'booster', 'OP-17', 'OP17')
const PROMO = ser('569901', 'promo', 'P', 'P')

function run(o: {
  series?: BandaiSeries; entries: BandaiEntry[]; products?: OpProduct[]
  bandai?: Record<string, string>; tcg?: Record<number, string>; stored?: Record<string, number>
}): ReturnType<typeof matchSeries> {
  return matchSeries({
    series: o.series ?? OP17, entries: o.entries, products: o.products ?? products,
    bandaiHash: (id) => o.bandai?.[id] ?? null, tcgHash: (p) => o.tcg?.[p.productId] ?? null,
    stored: new Map(Object.entries(o.stored ?? {}))
  })
}
const base = entry({}), p1 = entry({ bandaiId: 'OP17-005_p1', rarity: 'SR' }), p2 = entry({ bandaiId: 'OP17-005_p2', rarity: 'SR' })
const tcg5 = { 711499: H0, 708077: H2, 712083: H1 }

describe('One Piece matching', () => {
  test('sanity of test hashes', () => {
    expect(distance(H0, H1)).toBe(120)
    expect(distance(H1, H2)).toBe(240)
    expect(distance(H0, H0near)).toBe(2)
    expect(distance(H2, H2far)).toBe(20)
  })
  test('OP17-005: base, Alternate Art and Manga match by art, not by _p order', () => {
    const r = run({ entries: [base, p1, p2], bandai: { 'OP17-005': H0, 'OP17-005_p1': H1, 'OP17-005_p2': H2 }, tcg: tcg5 })
    expect(r.matches.get('OP17-005')).toMatchObject({ bandaiId: 'OP17-005', label: null })
    expect(r.matches.get('OP17-005')!.product.productId).toBe(711499)
    expect(r.matches.get('OP17-005_p1')!.product.productId).toBe(712083)
    expect(r.matches.get('OP17-005_p1')!.label).toBe('Manga')
    expect(r.matches.get('OP17-005_p2')!.product.productId).toBe(708077)
    expect(r.matches.get('OP17-005_p2')!.label).toBe('Alternate Art')
  })
  test('unmatched parallel stays unpriced', () => {
    const only = products.filter((p) => p.productId === 711499)
    const r = run({ entries: [p1], products: only, bandai: { 'OP17-005_p1': H1 }, tcg: tcg5 })
    expect(r.matches.size).toBe(0)
    expect(r.notes.join('\n')).toContain('no candidate')
    expect(r.tcgOnly).toBe(1)
  })
  test('two same-art candidates are ambiguous', () => {
    const r = run({ entries: [p1], bandai: { 'OP17-005_p1': H0 }, tcg: { 711499: H2, 708077: H0, 712083: H0near } })
    expect(r.matches.size).toBe(0)
    expect(r.notes.join('\n')).toContain('ambiguous')
  })
  test('the runner-up counts even beyond MATCH_MAX; inside MATCH_MARGIN only mutual nearest by FINISH_MARGIN matches', () => {
    const e = { 'OP17-005_p1': H0 }
    const near = bits(range(0, 5))
    const far = run({ entries: [p1], bandai: e, tcg: { 708077: near, 712083: bits(range(100, 160)) } })
    expect(far.matches.get('OP17-005_p1')!.product.productId).toBe(708077)
    // 5 against 30: inside MATCH_MARGIN, but one picture's two finishes sit that far apart.
    const finish = run({ entries: [p1], bandai: e, tcg: { 708077: near, 712083: bits(range(100, 130)) } })
    expect(finish.matches.get('OP17-005_p1')!.product.productId).toBe(708077)
    const close = run({ entries: [p1], bandai: e, tcg: { 708077: near, 712083: bits(range(100, 112)) } })
    expect(close.matches.size).toBe(0)
    expect(close.notes.join('\n')).toContain('ambiguous')
  })
  test('art disagrees', () => {
    const r = run({ entries: [base], bandai: { 'OP17-005': H0 }, tcg: { 711499: bits(range(0, 100)) } })
    expect(r.matches.size).toBe(0)
    expect(r.notes.join('\n')).toContain('art disagrees')
  })
  test('no art yet', () => {
    const r = run({ entries: [base], bandai: { 'OP17-005': H0 }, tcg: {} })
    expect(r.matches.size).toBe(0)
    expect(r.notes.join('\n')).toContain('no art yet')
  })
  test('SP listed on a later set', () => {
    const e = entry({ bandaiId: 'EB04-061_p2', number: 'EB04-061', rarity: 'SEC' })
    const r = run({ entries: [e], bandai: { 'EB04-061_p2': H1 }, tcg: { 710857: H1 } })
    expect(r.matches.get('EB04-061_p2')).toMatchObject({ label: null })
    expect(r.matches.get('EB04-061_p2')!.product.productId).toBe(710857)
  })
  test('promo by product name', () => {
    const pool: OpProduct[] = [{
      productId: 800001, groupId: 1, name: 'Spandine (Offline Regional Participation Pack 2025 Vol.1)',
      number: 'EB01-043', rarity: 'P', imageUrl: null
    }]
    const e1 = entry({ bandaiId: 'EB01-043_p1', number: 'EB01-043', rarity: 'P', cardSets: 'Offline Regional Participation Pack 2025 Vol.1', seriesId: PROMO.id })
    const e2 = entry({ bandaiId: 'EB01-043_p2', number: 'EB01-043', rarity: 'P', cardSets: 'Offline Regional Participation Pack 2025-26 Season 1', seriesId: PROMO.id })
    const r = run({ series: PROMO, entries: [e1, e2], products: pool, bandai: { 'EB01-043_p1': H0, 'EB01-043_p2': H0 }, tcg: { 800001: H0 } })
    expect(r.matches.get('EB01-043_p1')).toMatchObject({ label: null })
    expect(r.matches.get('EB01-043_p1')!.product.productId).toBe(800001)
    expect(r.matches.has('EB01-043_p2')).toBe(false)
    expect(r.notes.join('\n')).toContain('EB01-043_p2: no unambiguous TCGplayer product (no candidate)')
  })
  const extra: OpProduct = { productId: 900001, groupId: 24736, name: 'Edward.Newgate (005) (Special Foil)', number: 'OP17-005', rarity: 'SR', imageUrl: null }
  test('stored product wins', () => {
    const r = run({
      entries: [p1], products: [...products, extra], bandai: { 'OP17-005_p1': H2 },
      tcg: { ...tcg5, 708077: H2far, 900001: H2 }, stored: { 'OP17-005_p1': 708077 }
    })
    expect(r.matches.get('OP17-005_p1')!.product.productId).toBe(708077)
    expect([...r.matches.values()].some((m) => m.product.productId === 900001)).toBe(false)
    expect(r.notes).toContain('OP17-005_p1: matches 900001 now, keeps 708077')
  })
  test('a gone stored product frees the entry', () => {
    const r = run({ entries: [p1], bandai: { 'OP17-005_p1': H2 }, tcg: tcg5, stored: { 'OP17-005_p1': 999999 } })
    expect(r.matches.get('OP17-005_p1')!.product.productId).toBe(708077)
    expect(r.notes).toContain('OP17-005_p1: stored product 999999 is gone or disagrees')
  })
  test('starter-deck reprints match a plain or (Reprint) product of their number', () => {
    const ST31 = ser('569031', 'deck', 'ST-31', 'ST31')
    const at = (productId: number, name: string, number: string, rarity: string): OpProduct =>
      ({ productId, groupId: 24749, name, number, rarity, imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg` })
    // TCGplayer's ST-31 and ST-23 groups, as listed: no number tag, a number tag, `(Reprint)`.
    const deck = [
      at(706310, 'Nami', 'OP01-016', 'R'),
      at(706313, 'Monkey.D.Luffy (ST21-001)', 'ST21-001', 'L'),
      at(633760, 'Shanks (Reprint)', 'OP09-001', 'L'),
      at(706314, 'Sanji', 'ST31-001', 'SR')
    ]
    const e = (bandaiId: string, rarity: string): BandaiEntry =>
      entry({ bandaiId, number: bandaiId.split('_')[0], rarity, seriesId: ST31.id })
    const entries = [e('OP01-016_p9', 'R'), e('ST21-001_r1', 'L'), e('OP09-001_p2', 'L'), e('OP11-003_r1', 'UC'), e('ST31-001', 'SR')]
    const r = run({
      series: ST31, entries, products: deck,
      bandai: { 'OP01-016_p9': H0, 'ST21-001_r1': H1, 'OP09-001_p2': H2, 'OP11-003_r1': H0, 'ST31-001': H1 },
      tcg: { 706310: H0, 706313: H1, 633760: H2, 706314: H1 }
    })
    const got = Object.fromEntries([...r.matches.values()].map((m) => [m.bandaiId, m.product.productId]))
    expect(got).toEqual({ 'OP01-016_p9': 706310, 'ST21-001_r1': 706313, 'OP09-001_p2': 633760, 'ST31-001': 706314 })
    for (const m of r.matches.values()) expect(m.label).toBeNull()
    // TCGplayer lists the common reprints under their first set only.
    expect(r.notes).toContain('OP11-003_r1: no unambiguous TCGplayer product (no candidate)')
  })
  test('a booster SP does not take a plain product of its number', () => {
    const plain: OpProduct = { productId: 900002, groupId: 24736, name: 'Kid', number: 'OP14-108', rarity: 'R', imageUrl: null }
    const sp = entry({ bandaiId: 'OP14-108_p3', number: 'OP14-108', rarity: 'R' })
    const r = run({ entries: [sp], products: [plain], bandai: { 'OP14-108_p3': H0 }, tcg: { 900002: H0 } })
    expect(r.matches.size).toBe(0)
  })
  describe('a premium booster', () => {
    const PRB01 = ser('569301', 'booster', 'PRB-01', 'PRB01')
    const at = (productId: number, name: string, number: string): OpProduct =>
      ({ productId, groupId: 23496, name, number, rarity: 'C', imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg` })
    const e = (bandaiId: string, rarity: string): BandaiEntry =>
      entry({ bandaiId, number: bandaiId.split('_')[0], rarity, seriesId: PRB01.id })
    const got = (r: ReturnType<typeof matchSeries>): Record<string, number> =>
      Object.fromEntries([...r.matches.values()].map((m) => [m.bandaiId, m.product.productId]))

    test('SP takes the foils by mutual nearest, never the (Reprint); the reprint takes the (Reprint)', () => {
      // OP01-029 in PRB-01: one picture as Jolly Roger Foil, Textured Foil and a plain reprint.
      const products = [
        at(593001, 'Bartolomeo (Jolly Roger Foil)', 'OP01-029'),
        at(593002, 'Bartolomeo (Textured Foil)', 'OP01-029'),
        at(593003, 'Bartolomeo (Reprint)', 'OP01-029')
      ]
      const r = run({
        series: PRB01, products, entries: [e('OP01-029_p2', 'SP'), e('OP01-029_p3', 'SP'), e('OP01-029_r1', 'UC')],
        bandai: { 'OP01-029_p2': bits(range(0, 4)), 'OP01-029_p3': bits(range(40, 58)), 'OP01-029_r1': bits(range(80, 81)) },
        tcg: { 593001: H0, 593002: bits(range(40, 60)), 593003: bits(range(80, 81)) }
      })
      expect(got(r)).toEqual({ 'OP01-029_p2': 593001, 'OP01-029_p3': 593002, 'OP01-029_r1': 593003 })
    })

    test('a reprint entry with no (Reprint) product takes a leftover parallel: the Manga `_r2`', () => {
      const products = [at(594001, 'Shanks (Alternate Art)', 'OP01-120'), at(594002, 'Shanks (Manga)', 'OP01-120'), at(594003, 'Shanks (Reprint)', 'OP01-120')]
      const r = run({
        series: PRB01, products, entries: [e('OP01-120_p5', 'SEC'), e('OP01-120_r1', 'SEC'), e('OP01-120_r2', 'SEC')],
        bandai: { 'OP01-120_p5': H0, 'OP01-120_r1': H1, 'OP01-120_r2': H2 },
        tcg: { 594001: H0, 594002: H2, 594003: H1 }
      })
      expect(got(r)).toEqual({ 'OP01-120_p5': 594001, 'OP01-120_r1': 594003, 'OP01-120_r2': 594002 })
    })

    test('a plain reprint does not take its foil entry\'s leftover finish', () => {
      // The Textured Foil was not matched (its entry has no hash yet): the reprint is close to it, but so is that entry.
      const products = [at(595001, 'Kid (Jolly Roger Foil)', 'OP03-057'), at(595002, 'Kid (Textured Foil)', 'OP03-057')]
      const r = run({
        series: PRB01, products, entries: [e('OP03-057_p2', 'SP'), e('OP03-057_p3', 'SP'), e('OP03-057_r1', 'R')],
        bandai: { 'OP03-057_p2': H0, 'OP03-057_p3': bits(range(0, 6)), 'OP03-057_r1': bits(range(0, 8)) },
        tcg: { 595001: H0, 595002: bits(range(0, 6)) }
      })
      expect(got(r)['OP03-057_r1']).toBeUndefined()
    })
  })

  describe('stamp-free scans', () => {
    test('match past MATCH_MAX up to STAMP_MAX when the margin holds', () => {
      const r = run({ entries: [base, p2], bandai: { 'OP17-005': H0, 'OP17-005_p2': H2 }, tcg: { 711499: bits(range(0, 44)), 708077: H2 } })
      expect(r.matches.get('OP17-005')!.product.productId).toBe(711499)
      const tooFar = run({ entries: [base], bandai: { 'OP17-005': H0 }, tcg: { 711499: bits(range(0, 70)) } })
      expect(tooFar.notes.join('\n')).toContain('art disagrees')
    })
    test('not when another entry of the number is nearer that product', () => {
      // P-029_r2 in PRB-01: its only (Reprint) product is the Jolly Roger Foil entry's picture.
      const PRB01 = ser('569301', 'booster', 'PRB-01', 'PRB01')
      const products: OpProduct[] = [{ productId: 596001, groupId: 23496, name: 'Nami (Reprint)', number: 'P-029', rarity: 'P', imageUrl: null }]
      const r = run({
        series: PRB01, products,
        entries: [entry({ bandaiId: 'P-029_p3', number: 'P-029', rarity: 'P' }), entry({ bandaiId: 'P-029_r2', number: 'P-029', rarity: 'P' })],
        bandai: { 'P-029_p3': bits(range(0, 20)), 'P-029_r2': bits(range(100, 154)) },
        tcg: { 596001: H0 }
      })
      expect(r.matches.has('P-029_r2')).toBe(false)
      expect(r.notes).toContain('P-029_r2: no unambiguous TCGplayer product (art disagrees)')
    })
  })

  test('DON!! and sealed are skipped and counted', () => {
    const r = run({ entries: [base], bandai: { 'OP17-005': H0 }, tcg: { 711499: H0 } })
    expect(r.don).toBe(1)
    const ids = [...r.matches.values()].map((m) => m.product.productId)
    expect(ids).not.toContain(704752)
    const don = products.find((p) => p.rarity === 'DON!!' || p.name.startsWith('DON!! Card'))!
    expect(ids).not.toContain(don.productId)
    // 10 products: 1 DON, 1 sealed, 1 matched; the rest are TCGplayer-only
    expect(r.tcgOnly).toBe(products.length - 2 - 1)
  })
})
