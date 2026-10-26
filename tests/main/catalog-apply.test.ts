import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { applyChanges, finishApply } from '../../src/main/catalog/apply'
import { addEntry } from '../../src/main/repo/collection'
import { searchCards } from '../../src/main/repo/cards'
import type { CatalogChange } from '../../src/shared/catalogFeed'
import { seededDb } from './helpers'

interface P {
  id: number
  card_id: number
  set_name: string
  set_code: string
  set_rarity: string
  pkey: string
}

function pickPrinting(db: Database.Database): P {
  return db
    .prepare("SELECT * FROM card_printings WHERE language = 'en' AND contributed = 0 ORDER BY id LIMIT 1")
    .get() as P
}

const imageOf = (db: Database.Database, cardId: number): number =>
  (db.prepare('SELECT image_id AS id FROM card_images WHERE card_id = ? ORDER BY sort_order LIMIT 1').get(cardId) as {
    id: number
  }).id

const printingChange = (p: P, extra: Record<string, string | number | null> = {}): CatalogChange => ({
  seq: 1,
  table: 'card_printings',
  row: {
    id: 9001,
    pkey: p.pkey,
    card_id: p.card_id,
    set_name: p.set_name,
    set_code: p.set_code,
    set_rarity: p.set_rarity,
    language: 'en',
    contributed: 0,
    set_price: '1.23',
    ...extra
  }
})

describe('applyChanges', () => {
  it('upserts printings by pkey and keeps local ids', async () => {
    const db = await seededDb()
    const p = pickPrinting(db)
    const entry = addEntry(db, { printingId: p.id, imageId: imageOf(db, p.card_id), quantity: 1 })
    db.prepare('UPDATE card_printings SET missing_from_api = 1 WHERE id = ?').run(p.id)

    const r = applyChanges(db, [printingChange(p, { contributed: 1 })])

    expect(r).toEqual({ applied: 1, cardsChanged: false, imagesChanged: false })
    const row = db.prepare('SELECT * FROM card_printings WHERE set_code = ? AND set_rarity = ? AND card_id = ?')
      .all(p.set_code, p.set_rarity, p.card_id) as { id: number; remote_id: number; contributed: number; missing_from_api: number }[]
    expect(row).toHaveLength(1)
    expect(row[0].id).toBe(p.id)
    expect(row[0].remote_id).toBe(9001)
    expect(row[0].contributed).toBe(1)
    expect(row[0].missing_from_api).toBe(0)
    const e = db.prepare('SELECT printing_id FROM collection_entries WHERE id = ?').get(entry.id) as {
      printing_id: number
    }
    expect(e.printing_id).toBe(p.id)
  })

  it('keeps a deleted printing that an entry still uses', async () => {
    const db = await seededDb()
    const [a, b] = db
      .prepare("SELECT * FROM card_printings WHERE language = 'en' AND contributed = 0 ORDER BY id LIMIT 2")
      .all() as P[]
    addEntry(db, { printingId: a.id, imageId: imageOf(db, a.card_id), quantity: 1 })
    const other = addEntry(db, { printingId: b.id, imageId: imageOf(db, b.card_id), quantity: 1 })
    db.prepare('UPDATE collection_entries SET deleted_at = ?, dirty = 1 WHERE id = ?').run(
      '2026-10-24T00:00:00.000Z',
      (other as { id: number }).id
    )

    const r = applyChanges(db, [
      { seq: 1, table: 'card_printings', deleted: [a.pkey] },
      { seq: 2, table: 'card_printings', deleted: [b.pkey] }
    ])

    expect(r.applied).toBe(2)
    for (const p of [a, b]) {
      const row = db.prepare('SELECT missing_from_api AS m FROM card_printings WHERE id = ?').get(p.id) as { m: number }
      expect(row.m).toBe(1)
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()).toEqual({ n: 2 })
  })

  it('deletes an unused printing on tombstone', async () => {
    const db = await seededDb()
    const p = pickPrinting(db)
    const r = applyChanges(db, [
      { seq: 1, table: 'card_printings', deleted: [p.pkey] },
      { seq: 2, table: 'card_printings', deleted: ['en|0|NOPE|None'] }
    ])
    expect(r.applied).toBe(1)
    expect(db.prepare('SELECT 1 FROM card_printings WHERE id = ?').get(p.id)).toBeUndefined()
  })

  it('skips a card tombstone while an entry uses the card, and an image tombstone the entry uses', async () => {
    const db = await seededDb()
    const p = pickPrinting(db)
    const imageId = imageOf(db, p.card_id)
    addEntry(db, { printingId: p.id, imageId, quantity: 1 })

    const r = applyChanges(db, [
      { seq: 1, table: 'card_images', deleted: [imageId] },
      { seq: 2, table: 'cards', deleted: [p.card_id] }
    ])

    expect(r).toEqual({ applied: 0, cardsChanged: false, imagesChanged: false })
    expect(db.prepare('SELECT 1 FROM cards WHERE id = ?').get(p.card_id)).toBeDefined()
    expect(db.prepare('SELECT 1 FROM card_images WHERE image_id = ?').get(imageId)).toBeDefined()
    expect(db.prepare('SELECT 1 FROM card_printings WHERE id = ?').get(p.id)).toBeDefined()
  })

  it('skips a card tombstone when an entry reaches the card only through its image', async () => {
    const db = await seededDb()
    const first = pickPrinting(db)
    const b = db
      .prepare('SELECT card_id, image_id FROM card_images WHERE card_id <> ? ORDER BY image_id LIMIT 1')
      .get(first.card_id) as { card_id: number; image_id: number }
    // Reachable only through the image: the card has no printing an entry uses.
    db.prepare('DELETE FROM card_printings WHERE card_id = ?').run(b.card_id)
    db.prepare(
      `INSERT INTO collection_entries (uid, owner_id, printing_id, image_id, quantity, created_at, updated_at)
       VALUES ('img-only', 0, ?, ?, 1, 't', 't')`
    ).run(first.id, b.image_id)
    const r = applyChanges(db, [{ seq: 1, table: 'cards', deleted: [b.card_id] }])
    expect(r.cardsChanged).toBe(false)
    expect(db.prepare('SELECT 1 FROM cards WHERE id = ?').get(b.card_id)).toBeDefined()
  })

  it('deletes unused images and other-table rows by key', async () => {
    const db = await seededDb()
    const p = pickPrinting(db)
    const imageId = imageOf(db, p.card_id)
    db.prepare("INSERT INTO pack_art (set_name, image_url, image_key) VALUES ('X', 'u', 'k')").run()
    const r = applyChanges(db, [
      { seq: 1, table: 'card_images', deleted: [imageId] },
      { seq: 2, table: 'pack_art', deleted: ['X'] },
      { seq: 3, table: 'nope' as never, deleted: [1] }
    ])
    expect(r).toEqual({ applied: 2, cardsChanged: false, imagesChanged: true })
    expect(db.prepare("SELECT 1 FROM pack_art WHERE set_name = 'X'").get()).toBeUndefined()
  })

  it('rebuilds search after card changes', async () => {
    const db = await seededDb()
    const p = pickPrinting(db)
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(p.card_id) as Record<string, string | number | null>
    const r = applyChanges(db, [{ seq: 1, table: 'cards', row: { ...card, name: 'Zorblax Prime' } }])
    expect(r.cardsChanged).toBe(true)
    finishApply(db, r)
    expect(searchCards(db, 'Zorblax').map((c) => c.id)).toContain(p.card_id)
  })
})
