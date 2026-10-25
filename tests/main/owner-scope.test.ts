import type Database from 'better-sqlite3'
import { deleteMeta, setMeta } from '../../src/main/db/meta'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { getStats, recordSnapshot } from '../../src/main/repo/stats'
import { seededDb } from './helpers'

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
})
afterEach(() => db.close())

const ALL = { sort: 'name', dir: 'asc' } as const
const now = new Date('2026-10-25T12:00:00.000Z')
const pid = (code: string): number =>
  (db.prepare('SELECT id FROM card_printings WHERE set_code = ?').get(code) as { id: number }).id

test('entries and snapshots follow the active owner', () => {
  const x = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 2 }, now)
  expect(db.prepare('SELECT owner_id FROM collection_entries WHERE id = ?').get(x.id)).toEqual({
    owner_id: 0
  })

  setMeta(db, 'cloud_active_owner', '7')
  expect(listEntries(db, ALL)).toEqual([])
  const y = addEntry(db, { printingId: pid('LOB-EN119'), imageId: 55144522, quantity: 4 }, now)
  expect(db.prepare('SELECT owner_id FROM collection_entries WHERE id = ?').get(y.id)).toEqual({
    owner_id: 7
  })
  expect(listEntries(db, ALL).map((e) => e.id)).toEqual([y.id])
  recordSnapshot(db, now)
  expect(db.prepare('SELECT owner_id, total_cards FROM value_snapshots').all()).toEqual([
    { owner_id: 7, total_cards: 4 }
  ])
  const stats = getStats(db)
  expect(stats.totalCards).toBe(4)
  expect(stats.topEntries.map((e) => e.id)).toEqual([y.id])

  deleteMeta(db, 'cloud_active_owner')
  expect(listEntries(db, ALL).map((e) => e.id)).toEqual([x.id])
})

test('adding the same printing under two owners keeps separate rows', () => {
  const input = { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 1 }
  const a = addEntry(db, input, now)
  setMeta(db, 'cloud_active_owner', '7')
  const b = addEntry(db, input, now)
  expect(b.id).not.toBe(a.id)
  expect(b.quantity).toBe(1)
  const uids = db.prepare('SELECT uid FROM collection_entries ORDER BY id').all() as {
    uid: string
  }[]
  expect(new Set(uids.map((u) => u.uid)).size).toBe(2)
})
