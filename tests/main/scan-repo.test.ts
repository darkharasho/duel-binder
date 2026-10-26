import { describe, expect, it } from 'vitest'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsForCards,
  printingsForSet
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
})
