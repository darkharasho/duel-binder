import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addEntry, listEntries, removeEntry } from '../../src/main/repo/collection'
import { getChecklist } from '../../src/main/repo/sets'
import { getStats, recordSnapshot } from '../../src/main/repo/stats'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, seededServerDb } from './helpers'

const now = new Date('2026-10-24T12:00:00.000Z')
const ALL = { sort: 'name', dir: 'asc' } as const

describe('owner scope', () => {
  let db: Database.Database
  let u1: number
  let u2: number
  let printing: { id: number; card_id: number; set_name: string; language: 'en' }
  let imageId: number

  beforeEach(async () => {
    db = await seededServerDb()
    u1 = addUser(db, 'd1', 'one')
    u2 = addUser(db, 'd2', 'two')
    printing = db
      .prepare("SELECT id, card_id, set_name, language FROM card_printings WHERE language = 'en' ORDER BY id LIMIT 1")
      .get() as typeof printing
    imageId = (db.prepare('SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order, image_id LIMIT 1').get(printing.card_id) as { image_id: number }).image_id
  })

  const input = (quantity: number) => ({ printingId: printing.id, imageId, quantity })

  it('each user sees only their own entries', () => {
    addEntry(db, input(1), now, userScope(u1))
    addEntry(db, input(3), now, userScope(u2))
    const a = listEntries(db, ALL, userScope(u1))
    const b = listEntries(db, ALL, userScope(u2))
    expect(a.map((e) => e.quantity)).toEqual([1])
    expect(b.map((e) => e.quantity)).toEqual([3])
  })

  it('adding the same printing twice sums within one user only', () => {
    addEntry(db, input(1), now, userScope(u1))
    addEntry(db, input(2), now, userScope(u1))
    addEntry(db, input(5), now, userScope(u2))
    expect(listEntries(db, ALL, userScope(u1)).map((e) => e.quantity)).toEqual([3])
    expect(listEntries(db, ALL, userScope(u2)).map((e) => e.quantity)).toEqual([5])
  })

  it('remove tombstones on the server', () => {
    const s = userScope(u1)
    const e = addEntry(db, input(1), now, s)
    removeEntry(db, e.id, s)
    expect(listEntries(db, ALL, s)).toEqual([])
    const raw = db.prepare('SELECT deleted_at FROM collection_entries WHERE id = ?').get(e.id) as { deleted_at: string | null }
    expect(raw.deleted_at).not.toBeNull()
    const again = addEntry(db, input(2), now, s)
    expect(again.id).not.toBe(e.id)
    expect(listEntries(db, ALL, s).map((x) => x.quantity)).toEqual([2])
  })

  it('set checklist ownership is per user', () => {
    addEntry(db, input(2), now, userScope(u2))
    const owned = (s: ReturnType<typeof userScope>): number =>
      getChecklist(db, printing.set_name, printing.language, s)!.cards.reduce((n, c) => n + c.owned, 0)
    expect(owned(userScope(u1))).toBe(0)
    expect(owned(userScope(u2))).toBe(2)
  })

  it('stats and snapshots are per user', () => {
    addEntry(db, input(2), now, userScope(u1))
    recordSnapshot(db, now, userScope(u1))
    const rows = db.prepare('SELECT user_id, total_cards FROM value_snapshots').all()
    expect(rows).toEqual([{ user_id: u1, total_cards: 2 }])
    expect(getStats(db, userScope(u2)).totalCards).toBe(0)
    expect(getStats(db, userScope(u1)).totalCards).toBe(2)
  })

  it('userScope rejects a non-integer id', () => {
    expect(() => userScope(1.5)).toThrow()
    expect(() => userScope(NaN)).toThrow()
  })
})
