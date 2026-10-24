import { describe, expect, it, vi } from 'vitest'
import {
  createTcgplayerLookup,
  largeImageUrl,
  refreshTcgCatalog,
  shouldRefreshTcgCatalog
} from '../../src/main/tcgplayer/catalog'
import { printingImageKey } from '../../src/main/images/cache'
import { createPrintingArtResolver } from '../../src/main/yugipedia/artResolver'
import type { YugipediaClient } from '../../src/main/yugipedia/client'
import { seededDb } from './helpers'

const json = (results: unknown[]): Response =>
  new Response(JSON.stringify({ success: true, results }), { status: 200 })

const product = (id: number, number: string, rarity: string, imageCount = 1): unknown => ({
  productId: id,
  imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${id}_200w.jpg`,
  imageCount,
  extendedData: [
    { name: 'Number', value: number },
    { name: 'Rarity', value: rarity }
  ]
})

function catalogFetch(
  groups: { groupId: number; modifiedOn: string }[],
  products: Record<number, unknown[]>
): ReturnType<typeof vi.fn<(url: string) => Promise<Response>>> {
  return vi.fn<(url: string) => Promise<Response>>(async (url) => {
    if (url.endsWith('/groups')) return json(groups)
    const id = Number(/\/(\d+)\/products$/.exec(url)?.[1])
    if (products[id]) return json(products[id])
    return new Response('nope', { status: 500 })
  })
}

const printingId = (db: Awaited<ReturnType<typeof seededDb>>, code: string): number =>
  (db.prepare('SELECT id FROM card_printings WHERE set_code = ?').get(code) as { id: number }).id

describe('TCGplayer catalog', () => {
  it('largeImageUrl turns the listed thumbnail into the 1000px photo', () => {
    expect(largeImageUrl('https://tcgplayer-cdn.tcgplayer.com/product/635874_200w.jpg')).toBe(
      'https://tcgplayer-cdn.tcgplayer.com/product/635874_in_1000x1000.jpg'
    )
    expect(largeImageUrl('https://evil.example/635874_200w.jpg')).toBeNull()
  })

  it('stores products, matches printings by number and rarity, and skips unchanged groups', async () => {
    const db = await seededDb()
    const groups = [{ groupId: 10, modifiedOn: 'a' }]
    const fetchFn = catalogFetch(groups, {
      10: [
        product(1, 'LOB-EN005', 'Secret Rare'),
        product(2, 'LOB-EN005', 'Ultra Rare'),
        product(3, 'LOB-EN119', 'Short Print'),
        product(4, 'SDY-006', 'Ultra Rare', 0)
      ]
    })
    const now = new Date('2026-10-24T00:00:00Z')
    const r = await refreshTcgCatalog(db, {
      version: '1',
      fetchFn: fetchFn as unknown as typeof fetch,
      now
    })
    expect(r).toMatchObject({ groups: 1, updatedGroups: 1, ok: true })
    expect(shouldRefreshTcgCatalog(db, now)).toBe(false)

    const lookup = createTcgplayerLookup(db)
    // Same rarity wins over another product with that number.
    expect(lookup(printingId(db, 'LOB-EN005'))).toBe(
      'https://tcgplayer-cdn.tcgplayer.com/product/2_in_1000x1000.jpg'
    )
    // A lone product under a differently named rarity still counts.
    expect(lookup(printingId(db, 'LOB-EN119'))).toBe(
      'https://tcgplayer-cdn.tcgplayer.com/product/3_in_1000x1000.jpg'
    )
    // Products without a photo are left out.
    expect(lookup(printingId(db, 'SDY-006'))).toBeNull()

    fetchFn.mockClear()
    await refreshTcgCatalog(db, { version: '1', fetchFn: fetchFn as unknown as typeof fetch, now })
    expect(fetchFn).toHaveBeenCalledTimes(1) // just the group list
  })

  it('keeps going past a failed group and does not mark the catalog fresh', async () => {
    const db = await seededDb()
    const fetchFn = catalogFetch(
      [
        { groupId: 10, modifiedOn: 'a' },
        { groupId: 11, modifiedOn: 'a' }
      ],
      { 10: [product(2, 'LOB-EN005', 'Ultra Rare')] }
    )
    const now = new Date('2026-10-24T00:00:00Z')
    const r = await refreshTcgCatalog(db, {
      version: '1',
      fetchFn: fetchFn as unknown as typeof fetch,
      now
    })
    expect(r).toMatchObject({ updatedGroups: 1, failedGroups: 1, ok: false })
    expect(shouldRefreshTcgCatalog(db, now)).toBe(true)
    expect(createTcgplayerLookup(db)(printingId(db, 'LOB-EN005'))).not.toBeNull()
  })

  it('never rejects when the listing fails', async () => {
    const db = await seededDb()
    const fetchFn = vi.fn(async () => {
      throw new Error('offline')
    })
    const r = await refreshTcgCatalog(db, {
      version: '1',
      fetchFn: fetchFn as unknown as typeof fetch
    })
    expect(r.ok).toBe(false)
  })

  it('printingImageKey accepts TCGplayer photos and Yugipedia scans only', () => {
    expect(
      printingImageKey('https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg')
    ).toMatch(/^tp-[0-9a-f]{20}$/)
    expect(printingImageKey('https://ms.yugipedia.com/a/b.png')).toMatch(/^yp-/)
    expect(printingImageKey('https://tcgplayer-cdn.tcgplayer.com/other/1.jpg')).toBeNull()
  })

  it('the art resolver uses a quick TCGplayer match without asking Yugipedia', async () => {
    const db = await seededDb()
    const listPageImages = vi.fn(async () => new Map<string, string[]>())
    const client: YugipediaClient = {
      listSetListTitles: async () => [],
      fetchPages: async () => new Map(),
      listPageImages,
      fetchImageUrls: async () => new Map()
    }
    const art = createPrintingArtResolver({
      db,
      client,
      batchWaitMs: 0,
      quickUrl: () => 'https://tcgplayer-cdn.tcgplayer.com/product/2_in_1000x1000.jpg'
    })
    expect(await art.url(printingId(db, 'LOB-EN005'))).toContain('tcgplayer')
    expect(listPageImages).not.toHaveBeenCalled()
  })
})
