import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createLimiter } from '../../scripts/catalog/pokemon/http'
import type { TcGroup } from '../../scripts/catalog/pokemon/types'
import type { BandaiEntry, BandaiSeries } from '../../scripts/catalog/onepiece/types'
import { opGroups, opPrices, opProducts } from '../../scripts/catalog/onepiece/tcgcsv'
import { entryKind, mapGroups, productVersion, promoKey } from '../../scripts/catalog/onepiece/versions'

const readJson = (name: string): any => JSON.parse(readFileSync(join(__dirname, '../fixtures/onepiece', name), 'utf8'))

function fakeFetch(urls: string[], routes: Record<string, string | object>): typeof fetch {
  return (async (url: string) => {
    urls.push(String(url))
    const key = Object.keys(routes).find((k) => String(url).endsWith(k))
    if (!key) return new Response('not found', { status: 404 })
    const r = routes[key]
    return new Response(JSON.stringify(typeof r === 'string' ? readJson(r) : r), { status: 200 })
  }) as unknown as typeof fetch
}
const opts = (f: typeof fetch) => ({ fetch: f, userAgent: 'test', limiter: createLimiter(1), retryDelayMs: 0 })

const entry = (o: Partial<BandaiEntry>): BandaiEntry => ({
  bandaiId: 'OP17-005', number: 'OP17-005', rarity: 'SR', cardType: 'Character', name: 'x', cost: null, life: null,
  power: null, counter: null, colors: [], attribute: [], traits: [], block: null, effect: null, trigger: null,
  cardSets: '', seriesId: '569117', ...o
})
const ser = (id: string, kind: BandaiSeries['kind'], code: string, setCode: string): BandaiSeries =>
  ({ id, kind, title: code, code, setName: code, setCode })
const OP17 = ser('569117', 'booster', 'OP-17', 'OP17')
const EB04 = ser('569115', 'booster', 'OP15-EB04', 'OP15-EB04')
const ST31 = ser('569031', 'deck', 'ST-31', 'ST31')
const PROMO = ser('569901', 'promo', 'P', 'P')

describe('One Piece TCGplayer versions', () => {
  test('versions from TCGplayer names', () => {
    const v = (name: string, number: string | null = 'OP17-005', rarity: string | null = 'SR') =>
      productVersion({ productId: 1, groupId: 1, name, number, rarity, imageUrl: null })
    expect(v('Edward.Newgate (005)')).toEqual({ kind: 'base', label: null, skip: null })
    expect(v('Edward.Newgate (005) (Alternate Art)')).toEqual({ kind: 'parallel', label: 'Alternate Art', skip: null })
    expect(v('Kaido (062) (Super Alternate Art)', 'OP17-062')).toEqual({ kind: 'parallel', label: 'Super Alternate Art', skip: null })
    expect(v('Monkey.D.Luffy (EB04-061) (SP)', 'EB04-061', 'SEC').kind).toBe('sp')
    expect(v('Buggy (P-084) (SP)', 'P-084', 'PR').kind).toBe('sp')
    expect(v('DON!! Card (Alternate Art) (Gold)', null, 'DON!!').skip).toBe('don')
    expect(v("The World's Strongest Warriors Booster Box", null, null).skip).toBe('sealed')
    expect(v('Monkey.D.Luffy (Super Pre-Release) [Participant]', 'P-001', 'PR').label).toBe('Super Pre-Release [Participant]')
  })
  test('entry kinds', () => {
    expect(entryKind(entry({ bandaiId: 'OP17-005' }), OP17)).toBe('base')
    expect(entryKind(entry({ bandaiId: 'OP17-005_p1', rarity: 'SR' }), OP17)).toBe('parallel')
    expect(entryKind(entry({ bandaiId: 'OP14-108_p3', number: 'OP14-108', rarity: 'SP' }), OP17)).toBe('sp')
    expect(entryKind(entry({ bandaiId: 'X-001_p1', rarity: 'TR' }), OP17)).toBe('tr')
    expect(entryKind(entry({ bandaiId: 'EB01-043_p1', seriesId: '569901' }), PROMO)).toBe('promo')
    // Bandai lists a borrowed card on the OP-17 page as SEC; TCGplayer calls it SP.
    expect(entryKind(entry({ bandaiId: 'EB04-061_p2', number: 'EB04-061', rarity: 'SEC' }), OP17)).toBe('sp')
    expect(entryKind(entry({ bandaiId: 'EB04-061_p1', number: 'EB04-061', rarity: 'SEC', seriesId: '569115' }), EB04)).toBe('parallel')
  })
  test('series map to groups; stamps and promos apart', () => {
    const m = mapGroups([OP17, EB04, ST31, PROMO], readJson('tcgcsv-groups.json').results as TcGroup[])
    expect(m.bySeries.get('569117')?.groupId).toBe(24736)
    expect(m.bySeries.get('569115')?.groupId).toBe(24637)
    expect(m.bySeries.get('569031')?.groupId).toBe(24749)
    expect(m.stampGroups.map((g) => g.groupId)).toEqual([24775])
    expect(m.promoPool.map((g) => g.groupId).sort()).toEqual([17675, 23304])
  })
  test('promo keys', () => expect(promoKey('Included in Event Pack Vol.2')).toBe(promoKey('Event Pack Vol. 2')))
  test('fixture products and prices parse', async () => {
    const urls: string[] = []
    const o = opts(fakeFetch(urls, { '/68/24736/products': 'tcgcsv-op17-products.json', '/68/24736/prices': 'tcgcsv-op17-prices.json' }))
    const products = await opProducts(24736, o)
    expect(products).toHaveLength(10)
    expect(products.find((p) => p.productId === 704752)).toMatchObject({ number: null, rarity: null })
    expect(products.find((p) => p.productId === 708077)).toMatchObject({
      groupId: 24736, name: 'Edward.Newgate (005) (Alternate Art)', number: 'OP17-005', rarity: 'SR' })
    expect(products.find((p) => p.productId === 708077)?.imageUrl).toMatch(/^https:\/\//)
    const prices = await opPrices(24736, o)
    expect(prices).toHaveLength(readJson('tcgcsv-op17-prices.json').results.length)
    expect(urls).toEqual(['https://tcgcsv.com/tcgplayer/68/24736/products', 'https://tcgcsv.com/tcgplayer/68/24736/prices'])
  })
  test('imageCount 0 means no image', async () => {
    const body = { success: true, errors: [], results: [{ productId: 1, groupId: 2, name: 'A (001)', imageUrl: 'https://x/1.jpg', imageCount: 0 }] }
    const [p] = await opProducts(2, opts(fakeFetch([], { '/68/2/products': body })))
    expect(p.imageUrl).toBeNull()
  })
  test('an unsuccessful envelope rejects', async () => {
    const o = opts(fakeFetch([], { '/68/groups': { success: false, errors: ['down'], results: [] } }))
    await expect(opGroups(o)).rejects.toThrow()
  })
})
