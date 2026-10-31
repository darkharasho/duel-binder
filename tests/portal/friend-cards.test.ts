import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { friendsWithCard } from '../../workers/portal/src/friendCards'
import {
  acceptFriend,
  blockUser,
  requestFriend
} from '../../workers/portal/src/friends'
import { addEntry, removeEntry } from '../../src/main/repo/collection'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, seededServerDb } from './helpers'

const NOW = new Date('2026-10-24T12:00:00.000Z')

describe('friendsWithCard', () => {
  let db: Database.Database
  let me: number
  let bob: number
  let printing: { id: number; card_id: number; image_id: number }

  const friend = (a: string, id: number): void => {
    requestFriend(db, me, a, NOW)
    acceptFriend(db, id, me, NOW)
  }
  const give = (user: number, quantity: number): number =>
    addEntry(
      db,
      { printingId: printing.id, imageId: printing.image_id, quantity },
      NOW,
      userScope(user, 'ygo')
    ).id

  beforeEach(async () => {
    db = await seededServerDb()
    me = addUser(db, '1', 'me')
    bob = addUser(db, '2', 'bob')
    printing = db
      .prepare(
        `SELECT p.id, p.card_id, i.image_id FROM card_printings p
           JOIN card_images i ON i.card_id = p.card_id WHERE p.game = 'ygo' LIMIT 1`
      )
      .get() as typeof printing
  })

  it('groups a friend with their count and printing, without notes', () => {
    friend('bob', bob)
    give(bob, 3)
    const [row, ...rest] = friendsWithCard(db, me, 'ygo', printing.card_id)
    expect(rest).toEqual([])
    expect(row).toMatchObject({ id: bob, username: 'bob', quantity: 3 })
    expect(row.printings).toHaveLength(1)
    expect(row.printings[0].quantity).toBe(3)
    expect(JSON.stringify(row)).not.toContain('notes')
  })

  it('leaves out strangers, pending requests and me', () => {
    give(bob, 1)
    give(me, 1)
    expect(friendsWithCard(db, me, 'ygo', printing.card_id)).toEqual([])
    requestFriend(db, me, 'bob', NOW)
    expect(friendsWithCard(db, me, 'ygo', printing.card_id)).toEqual([])
  })

  it('a block ends it both ways', () => {
    friend('bob', bob)
    give(bob, 1)
    give(me, 1)
    blockUser(db, bob, me, NOW)
    expect(friendsWithCard(db, me, 'ygo', printing.card_id)).toEqual([])
    expect(friendsWithCard(db, bob, 'ygo', printing.card_id)).toEqual([])
  })

  it('leaves out removed entries, other cards and other games', () => {
    friend('bob', bob)
    const id = give(bob, 1)
    expect(friendsWithCard(db, me, 'ygo', printing.card_id + 1)).toEqual([])
    expect(friendsWithCard(db, me, 'pkm', printing.card_id)).toEqual([])
    removeEntry(db, id, NOW, userScope(bob, 'ygo'))
    expect(friendsWithCard(db, me, 'ygo', printing.card_id)).toEqual([])
  })

  it("walks friends' entries by index, not every printing", () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT p.id FROM collection_entries e
           JOIN card_printings p ON p.id = e.printing_id
          WHERE e.user_id IN (SELECT CASE WHEN requester_id = 1 THEN addressee_id ELSE requester_id END
                                FROM friendships
                               WHERE status = 'accepted' AND 1 IN (requester_id, addressee_id))
            AND e.game = 'ygo' AND e.deleted_at IS NULL AND +p.card_id = 1`
      )
      .all() as { detail: string }[]
    const text = plan.map((r) => r.detail).join('\n')
    expect(text).toMatch(/SEARCH e USING (COVERING )?INDEX/)
    expect(text).not.toMatch(/SCAN (e|p)\b/)
  })
})
