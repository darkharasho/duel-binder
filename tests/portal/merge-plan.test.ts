import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, seededServerDb } from './helpers'
import { cardTotal, planCardMerge, type CardOp } from '../../workers/portal/src/mergePlan'
import type { CardChoice } from '../../src/shared/account'

const NOW = '2026-11-02T12:00:00.000Z'

describe('planCardMerge', () => {
  let db: Database.Database
  let a: number
  let b: number
  let printings: number[]
  let images: number[]
  let seq = 0

  const add = (
    userId: number,
    printingId: number,
    imageId: number,
    quantity: number,
    deleted = false
  ): number =>
    Number(
      db
        .prepare(
          `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at,
             updated_at, deleted_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          `uid-${++seq}`,
          printingId,
          imageId,
          quantity,
          NOW,
          NOW,
          deleted ? NOW : null,
          seq
        ).lastInsertRowid
    )

  const liveTotal = (userId: number): number =>
    (
      db
        .prepare(
          'SELECT COALESCE(SUM(quantity), 0) AS n FROM collection_entries WHERE user_id = ? AND deleted_at IS NULL'
        )
        .get(userId) as { n: number }
    ).n

  /** Applies the ops the simple way Task 4's merge will, to check cardTotal against. */
  const apply = (ops: CardOp[]): void => {
    for (const op of ops) {
      if (op.kind === 'insert') add(a, op.from.printing_id, op.from.image_id, op.from.quantity)
      else if (op.kind === 'update')
        db.prepare('UPDATE collection_entries SET quantity = ? WHERE id = ?').run(
          op.quantity,
          op.id
        )
      else db.prepare('UPDATE collection_entries SET deleted_at = ? WHERE id = ?').run(NOW, op.id)
    }
  }

  let kaId: number

  beforeEach(async () => {
    db = await seededServerDb()
    a = addUser(db, '111', 'alice')
    b = addUser(db, '222', 'bob')
    printings = (
      db.prepare('SELECT id FROM card_printings ORDER BY id LIMIT 3').all() as { id: number }[]
    ).map((r) => r.id)
    images = (
      db.prepare('SELECT image_id FROM card_images ORDER BY image_id LIMIT 2').all() as {
        image_id: number
      }[]
    ).map((r) => r.image_id)
    const [k, ka, kb] = printings
    const img = images[0]
    add(a, k, img, 3)
    kaId = add(a, ka, img, 2)
    add(b, k, img, 5)
    add(b, kb, img, 4)
    // Removed rows are not cards: neither account's tombstones count.
    add(b, ka, img, 7, true)
    add(a, kb, img, 9, true)
  })

  const totalFor = (choice: CardChoice): number => cardTotal(db, a, planCardMerge(db, a, b, choice))

  it("higher keeps the larger count and adds the other's cards", () => {
    expect(totalFor('higher')).toBe(11)
    const ops = planCardMerge(db, a, b, 'higher')
    expect(ops.filter((o) => o.kind === 'update')).toEqual([
      { kind: 'update', id: expect.any(Number), quantity: 5, fromUid: expect.any(String) }
    ])
    expect(ops.filter((o) => o.kind === 'insert')).toHaveLength(1)
    expect(ops.filter((o) => o.kind === 'tombstone')).toEqual([])
  })

  it('sum adds counts', () => {
    expect(totalFor('sum')).toBe(14)
  })

  it('mine changes nothing', () => {
    expect(planCardMerge(db, a, b, 'mine')).toEqual([])
    expect(totalFor('mine')).toBe(5)
  })

  it('theirs replaces the collection', () => {
    expect(totalFor('theirs')).toBe(9)
    const ops = planCardMerge(db, a, b, 'theirs')
    expect(ops).toContainEqual({ kind: 'tombstone', id: kaId })
    expect(ops.filter((o) => o.kind === 'tombstone')).toHaveLength(1)
  })

  it('keeps different arts of one card apart', () => {
    const [k] = printings
    add(a, printings[2], images[1], 1)
    // Same printing as K in a different art: a second key, not K.
    add(b, k, images[1], 6)
    const ops = planCardMerge(db, a, b, 'higher')
    expect(ops.filter((o) => o.kind === 'update')).toHaveLength(1)
    const inserts = ops.flatMap((o) => (o.kind === 'insert' ? [o.from] : []))
    expect(inserts.map((e) => [e.printing_id, e.image_id, e.quantity]).sort()).toEqual(
      [
        [printings[2], images[0], 4],
        [k, images[1], 6]
      ].sort()
    )
    expect(totalFor('higher')).toBe(11 + 1 + 6)
  })

  it('cardTotal matches applying the ops', async () => {
    for (const choice of ['higher', 'sum', 'mine', 'theirs'] as const) {
      const ops = planCardMerge(db, a, b, choice)
      const expected = cardTotal(db, a, ops)
      db.exec('SAVEPOINT plan')
      apply(ops)
      expect(liveTotal(a), choice).toBe(expected)
      db.exec('ROLLBACK TO plan')
      db.exec('RELEASE plan')
    }
    expect(liveTotal(a)).toBe(5)
  })
})
