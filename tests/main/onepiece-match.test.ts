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
const products: OpProduct[] = fixture.results.map((p: any) => {
  const field = (n: string): string | null => p.extendedData?.find((e: any) => e.name === n)?.value ?? null
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
}) {
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
