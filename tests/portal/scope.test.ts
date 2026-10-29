import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addEntry, listEntries, removeEntry, updateEntry } from '../../src/main/repo/collection'
import { adjustPrinting, getChecklist } from '../../src/main/repo/sets'
import { getStats, recordSnapshot } from '../../src/main/repo/stats'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, seededServerDb } from './helpers'
import { SHARED_SET_NAME, seedPokemon } from '../fixtures/pokemon'
import type { GameId } from '../../src/shared/games'

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
    addEntry(db, input(1), now, userScope(u1, 'ygo'))
    addEntry(db, input(3), now, userScope(u2, 'ygo'))
    const a = listEntries(db, ALL, userScope(u1, 'ygo'))
    const b = listEntries(db, ALL, userScope(u2, 'ygo'))
    expect(a.map((e) => e.quantity)).toEqual([1])
    expect(b.map((e) => e.quantity)).toEqual([3])
  })

  it('adding the same printing twice sums within one user only', () => {
    addEntry(db, input(1), now, userScope(u1, 'ygo'))
    addEntry(db, input(2), now, userScope(u1, 'ygo'))
    addEntry(db, input(5), now, userScope(u2, 'ygo'))
    expect(listEntries(db, ALL, userScope(u1, 'ygo')).map((e) => e.quantity)).toEqual([3])
    expect(listEntries(db, ALL, userScope(u2, 'ygo')).map((e) => e.quantity)).toEqual([5])
  })

  it('inserts take distinct, increasing server_seq values', () => {
    const other = db
      .prepare(
        `SELECT p.id, i.image_id FROM card_printings p JOIN card_images i ON i.card_id = p.card_id
         WHERE p.id <> ? ORDER BY p.id, i.image_id LIMIT 1`
      )
      .get(printing.id) as { id: number; image_id: number }
    const a = addEntry(db, input(1), now, userScope(u1, 'ygo'))
    const b = addEntry(db, { printingId: other.id, imageId: other.image_id, quantity: 1 }, now, userScope(u1, 'ygo'))
    const seq = (id: number): number =>
      (db.prepare('SELECT server_seq FROM collection_entries WHERE id = ?').get(id) as { server_seq: number }).server_seq
    expect(seq(a.id)).toBeGreaterThan(0)
    expect(seq(b.id)).toBeGreaterThan(seq(a.id))
  })

  it('every server write takes a new server_seq', () => {
    const s = userScope(u1, 'ygo')
    const seq = (id: number): number =>
      (db.prepare('SELECT server_seq FROM collection_entries WHERE id = ?').get(id) as { server_seq: number }).server_seq
    const maxSeq = (): number =>
      (db.prepare('SELECT COALESCE(MAX(server_seq), 0) AS m FROM collection_entries').get() as { m: number }).m
    /** Runs `action` and checks each touched row now has a seq above every seq before it. */
    const bumps = (action: () => number[]): void => {
      const before = maxSeq()
      const touched = action()
      for (const id of touched) expect(seq(id)).toBeGreaterThan(before)
      expect(new Set(touched.map(seq)).size).toBe(touched.length)
    }
    const other = db
      .prepare(
        `SELECT p.id FROM card_printings p WHERE p.card_id = ? AND p.id <> ? ORDER BY p.id LIMIT 1`
      )
      .get(printing.card_id, printing.id) as { id: number }
    addEntry(db, input(1), now, userScope(u2, 'ygo')) // another user's row, so u1's seqs aren't the only ones
    let a = 0
    let b = 0
    bumps(() => [(a = addEntry(db, input(1), now, s).id)]) // add new
    bumps(() => [addEntry(db, input(2), now, s).id]) // add-sum
    bumps(() => [updateEntry(db, a, { notes: 'x' }, now, s).id]) // update
    bumps(() => [(b = addEntry(db, { printingId: other.id, imageId, quantity: 1 }, now, s).id)])
    bumps(() => [updateEntry(db, b, { printingId: printing.id }, now, s).id, b]) // update-merge, both rows
    expect(listEntries(db, ALL, s).map((e) => e.id)).toEqual([a])
    bumps(() => {
      adjustPrinting(db, printing.set_name, printing.language, printing.id, -1, now, s)
      return [a]
    })
    bumps(() => {
      removeEntry(db, a, now, s)
      return [a]
    })
    expect(listEntries(db, ALL, s)).toEqual([])
  })

  it('remove tombstones on the server', () => {
    const s = userScope(u1, 'ygo')
    const e = addEntry(db, input(1), now, s)
    removeEntry(db, e.id, undefined, s)
    expect(listEntries(db, ALL, s)).toEqual([])
    const raw = db.prepare('SELECT deleted_at FROM collection_entries WHERE id = ?').get(e.id) as { deleted_at: string | null }
    expect(raw.deleted_at).not.toBeNull()
    const again = addEntry(db, input(2), now, s)
    expect(again.id).not.toBe(e.id)
    expect(listEntries(db, ALL, s).map((x) => x.quantity)).toEqual([2])
  })

  it('set checklist ownership is per user', () => {
    addEntry(db, input(2), now, userScope(u2, 'ygo'))
    const owned = (s: ReturnType<typeof userScope>): number =>
      getChecklist(db, printing.set_name, printing.language, s)!.cards.reduce((n, c) => n + c.owned, 0)
    expect(owned(userScope(u1, 'ygo'))).toBe(0)
    expect(owned(userScope(u2, 'ygo'))).toBe(2)
  })

  it('stats and snapshots are per user', () => {
    addEntry(db, input(2), now, userScope(u1, 'ygo'))
    recordSnapshot(db, now, userScope(u1, 'ygo'))
    const rows = db.prepare('SELECT user_id, total_cards FROM value_snapshots').all()
    expect(rows).toEqual([{ user_id: u1, total_cards: 2 }])
    expect(getStats(db, userScope(u2, 'ygo')).totalCards).toBe(0)
    expect(getStats(db, userScope(u1, 'ygo')).totalCards).toBe(2)
  })

  it('userScope(id, pkm) reads and writes only Pokémon rows', () => {
    const pkm = seedPokemon(db)
    const ygo = userScope(u1, 'ygo')
    const poke = userScope(u1, 'pkm')
    addEntry(db, input(2), now, ygo)
    const e = addEntry(db, { printingId: pkm.printingIds[0], imageId: pkm.cardIds[0], quantity: 5 }, now, poke)
    expect(db.prepare('SELECT game FROM collection_entries WHERE id = ?').get(e.id)).toEqual({ game: 'pkm' })
    expect(listEntries(db, ALL, poke).map((x) => [x.card.id, x.quantity])).toEqual([[pkm.cardIds[0], 5]])
    expect(listEntries(db, ALL, ygo).map((x) => x.quantity)).toEqual([2])
    expect(listEntries(db, ALL, userScope(u1, 'ygo')).map((x) => x.quantity)).toEqual([2])
    expect(getStats(db, poke).totalCards).toBe(5)
    expect(getStats(db, ygo).totalCards).toBe(2)
    expect(getChecklist(db, SHARED_SET_NAME, 'en', poke)!.cards.map((c) => c.cardId)).toEqual([pkm.cardIds[0]])
    // A printing of the other game is not found through this scope.
    expect(() => addEntry(db, input(1), now, poke)).toThrow()
    removeEntry(db, e.id, now, ygo)
    expect(listEntries(db, ALL, poke)).toHaveLength(1)

    recordSnapshot(db, now, ygo)
    recordSnapshot(db, now, poke)
    const rows = db.prepare('SELECT game, total_cards FROM value_snapshots WHERE user_id = ? ORDER BY game').all(u1)
    expect(rows).toEqual([
      { game: 'pkm', total_cards: 5 },
      { game: 'ygo', total_cards: 2 }
    ])
    expect(getStats(db, poke).valueHistory.map((v) => v.totalCards)).toEqual([5])
  })

  it('userScope rejects an unknown game', () => {
    expect(() => userScope(u1, 'mtg' as GameId)).toThrow()
    expect(() => userScope(u1, "ygo' OR 1 --" as GameId)).toThrow()
  })

  it('userScope rejects a non-integer id', () => {
    expect(() => userScope(1.5, 'ygo')).toThrow()
    expect(() => userScope(NaN, 'ygo')).toThrow()
  })
})
