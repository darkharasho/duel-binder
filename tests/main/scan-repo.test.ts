import { describe, expect, it } from 'vitest'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsForCards,
  printingsForSet,
  scanRefs
} from '../../src/main/repo/scan'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { getMeta, setMeta } from '../../src/main/db/meta'

const LOB = 'Legend of Blue Eyes White Dragon'

async function scanDb(): Promise<{ db: Database.Database; cardId: number }> {
  const db = await seededDb()
  const card = db
    .prepare(
      "SELECT card_id AS cardId FROM card_printings WHERE set_code = 'LOB-EN005' AND language = 'en'"
    )
    .get() as { cardId: number }
  const add = db.prepare(
    'INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, ?, ?, ?, ?)'
  )
  add.run(card.cardId, LOB, 'LOB-EN005', 'Ultra Rare (Extended Art)', 'en')
  add.run(card.cardId, 'Legend of Blue Eyes (French)', 'LOB-FR005', 'Ultra Rare', 'fr')
  return { db, cardId: card.cardId }
}

describe('scan repo', () => {
  it("scanRefs names printings by this catalog's ids, leaving out the ones it lacks", async () => {
    const { db, cardId } = await scanDb()
    const id = (rarity: string): number =>
      (
        db
          .prepare("SELECT id FROM card_printings WHERE set_code = 'LOB-EN005' AND set_rarity = ?")
          .get(rarity) as { id: number }
      ).id
    const h = 'ab'.repeat(32)
    expect(
      scanRefs(db, {
        v: 1,
        refs: [
          {
            h,
            imageId: 7,
            printings: [
              `en|${cardId}|LOB-EN005|Ultra Rare (Extended Art)`,
              `en|${cardId}|LOB-EN005|Ultra Rare`,
              'ja|1|Nowhere|NOPE-JP001|Ultra Rare'
            ]
          },
          { h, imageId: 8, printings: ['ja|1|Nowhere|NOPE-JP001|Ultra Rare'] }
        ]
      })
    ).toEqual([{ h, imageId: 7, printingIds: [id('Ultra Rare (Extended Art)'), id('Ultra Rare')] }])
  })

  it('printingsByCode is case-insensitive, carries ordered image ids', async () => {
    const { db, cardId } = await scanDb()
    const rows = printingsByCode(db, 'lob-en005')
    expect(rows.map((r) => r.rarity)).toEqual(['Ultra Rare', 'Ultra Rare (Extended Art)'])
    expect(rows.every((r) => r.setCode === 'LOB-EN005' && r.name === 'Dark Magician')).toBe(true)
    const images = (
      db
        .prepare('SELECT image_id AS id FROM card_images WHERE card_id = ? ORDER BY sort_order')
        .all(cardId) as { id: number }[]
    ).map((i) => i.id)
    expect(images.length).toBeGreaterThan(0)
    expect(rows[0].imageIds).toEqual(images)
    const fr = printingsByCode(db, 'LOB-FR005')
    expect(fr.map((r) => r.language)).toEqual(['fr'])
    expect(rows.every((r) => r.language === 'en')).toBe(true)
  })

  it('printingsForSet returns every rarity, including the variant, sorted by code then tier', async () => {
    const { db } = await scanDb()
    const rows = printingsForSet(db, LOB, 'en')
    expect(rows.map((r) => `${r.setCode} ${r.rarity}`)).toEqual([
      'LOB-EN005 Ultra Rare',
      'LOB-EN005 Ultra Rare (Extended Art)',
      'LOB-EN119 Rare'
    ])
  })

  it('printingsForSet filters by language', async () => {
    const { db } = await scanDb()
    expect(printingsForSet(db, 'Legend of Blue Eyes (French)', 'fr').map((r) => r.setCode)).toEqual(
      ['LOB-FR005']
    )
    expect(printingsForSet(db, 'Legend of Blue Eyes (French)', 'en')).toEqual([])
  })

  it('sorts by code, then language order, then rarity', async () => {
    const { db, cardId } = await scanDb()
    db.prepare(
      'INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, ?, ?, ?, ?)'
    ).run(cardId, LOB, 'LOB-EN005', 'Ultra Rare', 'de')
    const langs = printingsByCode(db, 'LOB-EN005').map((r) => r.language)
    expect(langs).toEqual(['en', 'en', 'de'])
  })

  it('printingsForCards returns the cards printings in every language', async () => {
    const { db, cardId } = await scanDb()
    const rows = printingsForCards(db, [cardId])
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.every((r) => r.cardId === cardId)).toBe(true)
    expect(rows.some((r) => r.language === 'fr')).toBe(true)
    expect(printingsForCards(db, [])).toEqual([])
  })

  it('matchName finds a card through OCR noise', async () => {
    const { db } = await scanDb()
    expect(matchName(db, 'Dark Maglcian')?.name).toBe('Dark Magician')
    expect(matchName(db, 'zzzzzzzz')).toBeNull()
  })

  it('matchName sees the catalog again once its version changes', async () => {
    const { db, cardId } = await scanDb()
    expect(matchName(db, 'Dark Magician')?.cardId).toBe(cardId)
    db.prepare('UPDATE cards SET name = ? WHERE id = ?').run('Dark Paladin', cardId)
    // Same version: still the cached list.
    expect(matchName(db, 'Dark Magician')?.cardId).toBe(cardId)
    setMeta(db, 'db_version', `${getMeta(db, 'db_version') ?? ''}-next`)
    expect(matchName(db, 'Dark Paladin')).toMatchObject({ cardId, name: 'Dark Paladin' })
  })

  it('looks up more ids than fit in one query', async () => {
    const { db, cardId } = await scanDb()
    const images = (
      db.prepare('SELECT image_id AS imageId FROM card_images WHERE card_id = ?').all(cardId) as {
        imageId: number
      }[]
    ).map((i) => i.imageId)
    const filler = Array.from({ length: 1200 }, (_, i) => 900_000_000 + i)
    expect(cardsForImages(db, [...filler, ...images])).toEqual(
      [...images].sort((a, b) => a - b).map((imageId) => ({ imageId, cardId }))
    )
    const rows = printingsForCards(db, [...filler, cardId])
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.cardId === cardId && r.imageIds.length > 0)).toBe(true)
  })

  it('cardsForImages maps known artworks to their card and skips unknown ones', async () => {
    const { db, cardId } = await scanDb()
    const images = (
      db
        .prepare('SELECT image_id AS imageId FROM card_images WHERE card_id = ? ORDER BY image_id')
        .all(cardId) as {
        imageId: number
      }[]
    ).map((i) => i.imageId)
    expect(cardsForImages(db, [...images, 999999999])).toEqual(
      images.map((imageId) => ({ imageId, cardId }))
    )
    expect(cardsForImages(db, [])).toEqual([])
  })

  describe('price', () => {
    const priceOf = (db: Database.Database, code: string, rarity: string): number | null =>
      printingsByCode(db, code).find((r) => r.rarity === rarity)!.price
    const setCols = (
      db: Database.Database,
      code: string,
      rarity: string,
      market: number | null,
      set: number | null
    ): number => {
      const row = db
        .prepare('SELECT id FROM card_printings WHERE set_code = ? AND set_rarity = ?')
        .get(code, rarity) as { id: number }
      db.prepare('UPDATE card_printings SET market_price = ?, set_price = ? WHERE id = ?').run(
        market,
        set,
        row.id
      )
      return row.id
    }
    const ebay = (db: Database.Database, id: number, price: number): void => {
      db.prepare(
        "INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 1, '2026-01-01')"
      ).run(id, price)
    }

    it("carries each printing's own price: market, then eBay, then set price", async () => {
      const { db } = await scanDb()
      const R = 'Ultra Rare (Extended Art)'
      const id = setCols(db, 'LOB-EN005', R, 12.5, 3)
      expect(priceOf(db, 'LOB-EN005', R)).toBe(12.5)
      setCols(db, 'LOB-EN005', R, null, 3)
      expect(priceOf(db, 'LOB-EN005', R)).toBe(3)
      ebay(db, id, 7)
      expect(priceOf(db, 'LOB-EN005', R)).toBe(7)
    })

    it('a non-English printing is priced from eBay only', async () => {
      const { db } = await scanDb()
      const id = setCols(db, 'LOB-FR005', 'Ultra Rare', 9, 3)
      expect(priceOf(db, 'LOB-FR005', 'Ultra Rare')).toBeNull()
      ebay(db, id, 4)
      expect(priceOf(db, 'LOB-FR005', 'Ultra Rare')).toBe(4)
    })

    it('a zero or missing price is null', async () => {
      const { db } = await scanDb()
      const R = 'Ultra Rare (Extended Art)'
      setCols(db, 'LOB-EN005', R, null, 0)
      expect(priceOf(db, 'LOB-EN005', R)).toBeNull()
      setCols(db, 'LOB-EN005', R, null, null)
      expect(priceOf(db, 'LOB-EN005', R)).toBeNull()
    })
  })
})
