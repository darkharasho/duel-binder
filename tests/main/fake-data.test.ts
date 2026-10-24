import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { seedFakeCollection } from '../../src/main/dev/fakeData'
import { seededDb } from './helpers'

const NOW = new Date(2026, 9, 23, 12)

describe('seedFakeCollection', () => {
  it('owns every card of a fully planned set and writes a value history', async () => {
    const db = await seededDb()
    expect(seedFakeCollection(db, NOW)).toBeGreaterThan(0)

    const lobCards = db
      .prepare(
        `SELECT COUNT(DISTINCT p.card_id) AS n FROM collection_entries e
         JOIN card_printings p ON p.id = e.printing_id WHERE p.set_name = 'Legend of Blue Eyes White Dragon'`
      )
      .get() as { n: number }
    expect(lobCards.n).toBe(2)

    const snapshots = db.prepare('SELECT date FROM value_snapshots ORDER BY date').all() as {
      date: string
    }[]
    expect(snapshots).toHaveLength(91)
    expect(snapshots.at(-1)?.date).toBe('2026-10-23')
  })

  it('does nothing when the collection already has entries', async () => {
    const db = await seededDb()
    seedFakeCollection(db, NOW)
    const before = db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()
    expect(seedFakeCollection(db, NOW)).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()).toEqual(before)
  })

  it('does nothing before the catalogue is synced', () => {
    const db = openDatabase(':memory:')
    expect(seedFakeCollection(db, NOW)).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM value_snapshots').get()).toEqual({ n: 0 })
  })
})
