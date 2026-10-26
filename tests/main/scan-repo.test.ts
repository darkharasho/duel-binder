import { describe, expect, it } from 'vitest'
import {
  matchName,
  printingsByCode,
  printingsForCards,
  printingsForSet
} from '../../src/main/repo/scan'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'

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
  it('printingsByCode is case-insensitive, English-only and carries ordered image ids', async () => {
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
    expect(printingsByCode(db, 'LOB-FR005')).toEqual([])
  })

  it('printingsForSet returns every rarity, including the variant, sorted by code then tier', async () => {
    const { db } = await scanDb()
    const rows = printingsForSet(db, LOB)
    expect(rows.map((r) => `${r.setCode} ${r.rarity}`)).toEqual([
      'LOB-EN005 Ultra Rare',
      'LOB-EN005 Ultra Rare (Extended Art)',
      'LOB-EN119 Rare'
    ])
  })

  it('printingsForCards returns the cards English printings', async () => {
    const { db, cardId } = await scanDb()
    const rows = printingsForCards(db, [cardId])
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.every((r) => r.cardId === cardId)).toBe(true)
    expect(printingsForCards(db, [])).toEqual([])
  })

  it('matchName finds a card through OCR noise', async () => {
    const { db } = await scanDb()
    expect(matchName(db, 'Dark Maglcian')?.name).toBe('Dark Magician')
    expect(matchName(db, 'zzzzzzzz')).toBeNull()
  })
})
