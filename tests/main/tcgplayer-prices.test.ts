import { describe, expect, it, vi } from 'vitest'
import { refreshTcgCatalog } from '../../src/main/tcgplayer/catalog'
import {
  applyTcgPrices,
  pickMarketPrice,
  refreshTcgPrices,
  TCG_PRICES_INTERVAL_MS
} from '../../src/main/tcgplayer/prices'
import { addEntry } from '../../src/main/repo/collection'
import { seededDb } from './helpers'

const json = (results: unknown[]): Response =>
  new Response(JSON.stringify({ success: true, results }), { status: 200 })

const product = (id: number, number: string, rarity: string): unknown => ({
  productId: id,
  name: 'Card',
  imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`,
  imageCount: 1,
  extendedData: [
    { name: 'Number', value: number },
    { name: 'Rarity', value: rarity }
  ]
})

const price = (productId: number, subTypeName: string, marketPrice: number | null): unknown => ({
  productId,
  subTypeName,
  marketPrice,
  lowPrice: 0.01,
  midPrice: 1
})

type Db = Awaited<ReturnType<typeof seededDb>>

function tcgFetch(
  prices: Record<number, unknown[]>
): ReturnType<typeof vi.fn<(url: string) => Promise<Response>>> {
  return vi.fn<(url: string) => Promise<Response>>(async (url) => {
    if (url.endsWith('/groups'))
      return json([
        { groupId: 10, modifiedOn: 'a' },
        { groupId: 20, modifiedOn: 'a' }
      ])
    const products = /\/(\d+)\/products$/.exec(url)
    if (products) {
      if (products[1] === '10')
        return json([product(1, 'LOB-EN005', 'Ultra Rare'), product(3, 'LOB-EN119', 'Rare')])
      return json([product(2, 'SDY-006', 'Ultra Rare')])
    }
    const id = Number(/\/(\d+)\/prices$/.exec(url)?.[1])
    if (prices[id]) return json(prices[id])
    return new Response('nope', { status: 500 })
  })
}

async function withCatalog(prices: Record<number, unknown[]>): Promise<{
  db: Db
  fetchFn: ReturnType<typeof tcgFetch>
}> {
  const db = await seededDb()
  const fetchFn = tcgFetch(prices)
  await refreshTcgCatalog(db, { version: '1', fetchFn: fetchFn as unknown as typeof fetch })
  fetchFn.mockClear()
  return { db, fetchFn }
}

const pid = (db: Db, code: string): number =>
  (
    db
      .prepare("SELECT id FROM card_printings WHERE set_code = ? AND language = 'en'")
      .get(code) as { id: number }
  ).id

const marketPrice = (db: Db, code: string): number | null =>
  (
    db.prepare('SELECT market_price FROM card_printings WHERE id = ?').get(pid(db, code)) as {
      market_price: number | null
    }
  ).market_price

const priceUrls = (fetchFn: ReturnType<typeof tcgFetch>): string[] =>
  fetchFn.mock.calls.map(([u]) => u).filter((u) => u.endsWith('/prices'))

const NOW = new Date('2026-10-25T12:00:00Z')

describe('TCGplayer market prices', () => {
  it('pickMarketPrice prefers 1st Edition, then Limited, then Unlimited, skipping missing prices', () => {
    expect(
      pickMarketPrice([
        { subTypeName: 'Unlimited', marketPrice: 1 },
        { subTypeName: '1st Edition', marketPrice: 9 }
      ])
    ).toBe(9)
    expect(
      pickMarketPrice([
        { subTypeName: 'Unlimited', marketPrice: 1 },
        { subTypeName: '1st Edition', marketPrice: null },
        { subTypeName: 'Limited', marketPrice: 4 }
      ])
    ).toBe(4)
    expect(pickMarketPrice([{ subTypeName: 'Unlimited', marketPrice: 2.5 }])).toBe(2.5)
    expect(pickMarketPrice([{ subTypeName: 'Foil', marketPrice: 3 }])).toBe(3)
    expect(pickMarketPrice([{ subTypeName: '1st Edition', marketPrice: 0 }])).toBeNull()
    expect(pickMarketPrice([])).toBeNull()
  })

  it('fetches every set in "all" scope and resolves each English printing to its product price', async () => {
    const { db, fetchFn } = await withCatalog({
      10: [price(1, '1st Edition', 71.73), price(1, 'Unlimited', 20), price(3, 'Unlimited', 0.5)],
      20: [price(2, 'Unlimited', null)]
    })
    const r = await refreshTcgPrices(db, {
      version: '1',
      scope: 'all',
      fetchFn: fetchFn as never,
      now: NOW
    })
    expect(r).toEqual({ groups: 2, updatedGroups: 2, failedGroups: 0 })
    expect(applyTcgPrices(db)).toBe(2)
    expect(marketPrice(db, 'LOB-EN005')).toBe(71.73)
    expect(marketPrice(db, 'LOB-EN119')).toBe(0.5)
    expect(marketPrice(db, 'SDY-006')).toBeNull()
    // Nothing changed, nothing rewritten.
    expect(applyTcgPrices(db)).toBe(0)

    // Within the interval nothing is due.
    fetchFn.mockClear()
    const again = await refreshTcgPrices(db, {
      version: '1',
      scope: 'all',
      fetchFn: fetchFn as never,
      now: new Date(NOW.getTime() + TCG_PRICES_INTERVAL_MS - 1)
    })
    expect(again.updatedGroups).toBe(0)
    expect(priceUrls(fetchFn)).toEqual([])
  })

  it('a price that disappears clears the printing', async () => {
    const prices: Record<number, unknown[]> = { 10: [price(1, '1st Edition', 5)], 20: [] }
    const { db, fetchFn } = await withCatalog(prices)
    await refreshTcgPrices(db, { version: '1', scope: 'all', fetchFn: fetchFn as never, now: NOW })
    applyTcgPrices(db)
    expect(marketPrice(db, 'LOB-EN005')).toBe(5)
    prices[10] = []
    await refreshTcgPrices(db, {
      version: '1',
      scope: 'all',
      fetchFn: fetchFn as never,
      now: new Date(NOW.getTime() + TCG_PRICES_INTERVAL_MS)
    })
    expect(applyTcgPrices(db)).toBe(1)
    expect(marketPrice(db, 'LOB-EN005')).toBeNull()
  })

  it('"owned" scope fetches only sets holding owned English printings, plus newly owned ones early', async () => {
    const { db, fetchFn } = await withCatalog({
      10: [price(1, '1st Edition', 5)],
      20: [price(2, 'Unlimited', 7)]
    })
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: 46986414, quantity: 1 })
    await refreshTcgPrices(db, {
      version: '1',
      scope: 'owned',
      fetchFn: fetchFn as never,
      now: NOW
    })
    expect(priceUrls(fetchFn)).toEqual(['https://tcgcsv.com/tcgplayer/2/10/prices'])

    // A card from another set is added: its set is fetched on the next run, before the interval.
    const sdy = pid(db, 'SDY-006')
    const image = (
      db.prepare('SELECT card_id FROM card_printings WHERE id = ?').get(sdy) as { card_id: number }
    ).card_id
    const imageId = (
      db.prepare('SELECT image_id FROM card_images WHERE card_id = ? LIMIT 1').get(image) as {
        image_id: number
      }
    ).image_id
    addEntry(db, { printingId: sdy, imageId, quantity: 1 })
    fetchFn.mockClear()
    await refreshTcgPrices(db, {
      version: '1',
      scope: 'owned',
      fetchFn: fetchFn as never,
      now: NOW
    })
    expect(priceUrls(fetchFn)).toEqual(['https://tcgcsv.com/tcgplayer/2/20/prices'])
    applyTcgPrices(db)
    expect(marketPrice(db, 'SDY-006')).toBe(7)
  })

  it('keeps going past a failed set, which stays due, and never rejects', async () => {
    const { db, fetchFn } = await withCatalog({ 10: [price(1, '1st Edition', 5)] })
    const r = await refreshTcgPrices(db, {
      version: '1',
      scope: 'all',
      fetchFn: fetchFn as never,
      now: NOW
    })
    expect(r).toEqual({ groups: 2, updatedGroups: 1, failedGroups: 1 })
    fetchFn.mockClear()
    await refreshTcgPrices(db, { version: '1', scope: 'all', fetchFn: fetchFn as never, now: NOW })
    expect(priceUrls(fetchFn)).toEqual(['https://tcgcsv.com/tcgplayer/2/20/prices'])

    const broken = vi.fn(async () => {
      throw new Error('offline')
    })
    db.prepare('DELETE FROM tcgplayer_price_groups').run()
    await expect(
      refreshTcgPrices(db, { version: '1', scope: 'all', fetchFn: broken as never, now: NOW })
    ).resolves.toMatchObject({ failedGroups: 2 })
  })
})
