import type Database from 'better-sqlite3'
import { addEntry } from '../../src/main/repo/collection'
import { getStats, recordSnapshot } from '../../src/main/repo/stats'
import { seededDb } from './helpers'

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
})
afterEach(() => db.close())

const pid = (code: string): number =>
  (db.prepare('SELECT id FROM card_printings WHERE set_code = ?').get(code) as { id: number }).id

test('empty collection', () => {
  const s = getStats(db)
  expect(s).toMatchObject({
    totalCards: 0,
    uniqueCards: 0,
    totalValue: 0,
    approximateCount: 0,
    byRarity: [],
    byFrameType: [],
    topEntries: []
  })
  expect(Number.isNaN(s.totalValue)).toBe(false)
  expect(s.pricesUpdatedAt).toBe('2026-10-23T12:00:00.000Z')
})

test('totals', () => {
  addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 2 })
  addEntry(db, { printingId: pid('SDY-006'), imageId: 46986414, quantity: 1 })
  addEntry(db, { printingId: pid('LOB-EN119'), imageId: 55144522, quantity: 4 })
  const s = getStats(db)
  expect(s.totalCards).toBe(7)
  expect(s.uniqueCards).toBe(2)
  expect(s.totalValue).toBeCloseTo(10.24 + 7.5 + 14)
  expect(s.approximateCount).toBe(1)
  expect(s.topEntries[0].totalValue).toBeCloseTo(14)
  const values = s.byRarity.map((r) => r.value)
  expect(values).toEqual([...values].sort((a, b) => b - a))
  expect(s.byRarity.reduce((n, r) => n + r.count, 0)).toBe(7)
  const counts = s.byFrameType.map((f) => f.count)
  expect(counts).toEqual([...counts].sort((a, b) => b - a))
  expect(counts.reduce((a, b) => a + b, 0)).toBe(7)
})

test('topEntries capped at 10', () => {
  for (let i = 0; i < 12; i++) {
    const id = 900000 + i
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (?, ?, 'Normal Monster', 'normal', 'Warrior', '', '')`
    ).run(id, `Synthetic ${i}`)
    db.prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (?, ?, 0)').run(id, id)
    const p = db
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_price) VALUES (?, 'Synth', ?, 'Common', ?)`
      )
      .run(id, `SYN-${i}`, i + 1)
    addEntry(db, { printingId: Number(p.lastInsertRowid), imageId: id, quantity: 1 })
  }
  const s = getStats(db)
  expect(s.topEntries).toHaveLength(10)
  expect(s.topEntries[0].totalValue).toBe(12)
  expect(s.topEntries[9].totalValue).toBe(3)
})

test('snapshot is one row per day', () => {
  addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 2 })
  recordSnapshot(db, new Date(2026, 9, 23, 9, 0))
  addEntry(db, { printingId: pid('LOB-EN119'), imageId: 55144522, quantity: 1 })
  recordSnapshot(db, new Date(2026, 9, 23, 18, 0))
  let rows = db.prepare('SELECT * FROM value_snapshots').all() as { date: string; total_value: number; total_cards: number }[]
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ date: '2026-10-23', total_cards: 3 })
  expect(rows[0].total_value).toBeCloseTo(5.12 * 2 + 3.5)
  recordSnapshot(db, new Date(2026, 9, 24, 8, 0))
  rows = db.prepare('SELECT * FROM value_snapshots ORDER BY date').all() as typeof rows
  expect(rows.map((r) => r.date)).toEqual(['2026-10-23', '2026-10-24'])
})
