import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { SqlDb } from '../../../src/main/db/sql'
import type { CardChoice } from '../../../src/shared/account'
import type { Me } from '../../../src/shared/cloud'
import { doSql } from '../src/doSql'
import { deleteUserData } from '../src/account'
import { mergeAccounts, mergedFrom, purgeHolds } from '../src/merge'
import { cardTotal, planCardMerge } from '../src/mergePlan'

// The merge's queries run on workerd's Durable Object SQLite, which refuses some queries
// better-sqlite3 runs (large compound queries), so the whole merge is tried here.

const TS = '2026-10-24T10:00:00.000Z'
const CARD = 1000

async function hash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function stubOf(name: string): DurableObjectStub {
  return env.STORE.get(env.STORE.idFromName(name))
}
const inStore = <R>(name: string, fn: (db: SqlDb) => R): Promise<R> =>
  runInDurableObject(stubOf(name), (_i, state) => fn(doSql(state.storage)))

const liveTotal = (db: SqlDb, userId: number): number =>
  (
    db
      .prepare(
        'SELECT COALESCE(SUM(quantity), 0) AS n FROM collection_entries WHERE user_id = ? AND deleted_at IS NULL'
      )
      .get(userId) as { n: number }
  ).n

/**
 * Users 1 (Discord 111, signed in as `meHash`) and 2 (Apple sub2) with Task 3's cards (5 and 9),
 * a wish, a favourite, a binder with an edit, a friend and a block each.
 */
function seed(db: SqlDb, meHash: string): void {
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
     VALUES (?, 'Dragon', 'Normal Monster', 'normal', 'Dragon', '', ?, 'ygo')`
  ).run(CARD, TS)
  db.prepare(
    "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'ygo')"
  ).run(CARD, CARD)
  const printing = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, game)
     VALUES (?, 'Set', ?, 'Rare', 'ygo')`
  )
  for (let i = 0; i < 3; i++) printing.run(CARD, `S-${i}`)
  const [k, ka, kb] = (
    db.prepare('SELECT id FROM card_printings ORDER BY id').all() as { id: number }[]
  ).map((r) => r.id)

  const user = db.prepare(
    'INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  const signIn = db.prepare(
    'INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)'
  )
  user.run(1, '111', 'kaiba', TS, TS)
  signIn.run('discord', '111', 1, TS)
  user.run(2, 'apple:sub2', 'appleuser', TS, TS)
  signIn.run('apple', 'sub2', 2, TS)
  user.run(3, '333', 'friend', TS, TS)
  signIn.run('discord', '333', 3, TS)
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at)
     VALUES (?, 1, 'desktop', ?, '2999-01-01T00:00:00.000Z')`
  ).run(meHash, TS)

  const card = db.prepare(
    `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at,
       updated_at, deleted_at, server_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(server_seq), 0) + 1 FROM collection_entries))`
  )
  card.run(1, crypto.randomUUID(), k, CARD, 3, TS, TS, null)
  card.run(1, crypto.randomUUID(), ka, CARD, 2, TS, TS, null)
  card.run(1, crypto.randomUUID(), kb, CARD, 9, TS, TS, TS)
  card.run(2, crypto.randomUUID(), k, CARD, 5, TS, TS, null)
  card.run(2, crypto.randomUUID(), kb, CARD, 4, TS, TS, null)
  card.run(2, crypto.randomUUID(), ka, CARD, 7, TS, TS, TS)

  db.prepare(
    `INSERT INTO wishlist_entries (user_id, pkey, game, quantity, created_at, updated_at, seq)
     VALUES (1, 'p1', 'ygo', 1, ?, ?, 1), (2, 'p1', 'ygo', 3, ?, ?, 2), (2, 'p2', 'ygo', NULL, ?, ?, 3)`
  ).run(TS, TS, TS, TS, TS, TS)
  db.prepare(
    `INSERT INTO favourites (user_id, card_id, game, created_at, updated_at, seq)
     VALUES (2, ?, 'ygo', ?, ?, 1)`
  ).run(CARD, TS, TS)
  db.prepare(
    `INSERT INTO binders (user_id, uid, game, name, rules, goal, languages, created_at, updated_at, seq)
     VALUES (1, 'b-me', 'ygo', 'Trade', '[]', 'all', '[]', ?, ?, 1),
            (2, 'b-1', 'ygo', 'Trade', '[]', 'all', '[]', ?, ?, 2)`
  ).run(TS, TS, TS, TS)
  db.prepare(
    `INSERT INTO binder_edits (user_id, binder_uid, level, target, game, action, created_at, updated_at, seq)
     VALUES (2, 'b-1', 'card', '42', 'ygo', 'add', ?, ?, 1)`
  ).run(TS, TS)
  db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
     VALUES (3, 2, 'accepted', ?, ?), (1, 2, 'accepted', ?, ?)`
  ).run(TS, TS, TS, TS)
}

describe('merging accounts on Durable Object SQLite', () => {
  it('account:merge with a ticket merges to the previewed total', async () => {
    const name = 'merge-rpc'
    const meHash = await hash('me')
    const ticket = 'ticket-0123456789'
    const ticketHash = await hash(ticket)
    const expected = await inStore(name, (db) => {
      seed(db, meHash)
      db.prepare(
        `INSERT INTO merge_tickets (ticket_hash, user_id, other_id, provider, subject, expires_at)
         VALUES (?, 1, 2, 'apple', 'sub2', '2999-01-01T00:00:00.000Z')`
      ).run(ticketHash)
      return cardTotal(db, 1, planCardMerge(db, 1, 2, 'theirs'))
    })
    expect(expected).toBe(9)

    const res = await stubOf(name).fetch('https://app.duelbinder.com/api/rpc/account:merge', {
      method: 'POST',
      headers: { authorization: 'Bearer me', 'content-type': 'application/json' },
      body: JSON.stringify({ args: [ticket, { cards: 'theirs', username: 'theirs' }] })
    })
    expect(res.status).toBe(200)
    const me = ((await res.json()) as { result: Me }).result
    expect(me).toMatchObject({ id: 1, username: 'appleuser', mergedFrom: [2] })

    const after = await inStore(name, (db) => ({
      total: liveTotal(db, 1),
      closedTotal: liveTotal(db, 2),
      signIns: db
        .prepare('SELECT provider FROM sign_ins WHERE user_id = 1 ORDER BY provider')
        .all(),
      friends: db.prepare('SELECT requester_id, addressee_id FROM friendships').all(),
      binders: db.prepare('SELECT uid, name FROM binders WHERE user_id = 1 ORDER BY uid').all(),
      edits: db.prepare('SELECT binder_uid FROM binder_edits WHERE user_id = 1').all(),
      wishes: db
        .prepare('SELECT pkey, quantity FROM wishlist_entries WHERE user_id = 1 ORDER BY pkey')
        .all(),
      favourites: db.prepare('SELECT card_id FROM favourites WHERE user_id = 1').all(),
      tickets: db.prepare('SELECT count(*) AS n FROM merge_tickets').get()
    }))
    expect(after).toEqual({
      total: 9,
      closedTotal: 9,
      signIns: [{ provider: 'apple' }, { provider: 'discord' }],
      friends: [{ requester_id: 3, addressee_id: 1 }],
      binders: [
        { uid: 'b-1', name: 'Trade (2)' },
        { uid: 'b-me', name: 'Trade' }
      ],
      edits: [{ binder_uid: 'b-1' }],
      wishes: [
        { pkey: 'p1', quantity: 3 },
        { pkey: 'p2', quantity: null }
      ],
      favourites: [{ card_id: CARD }],
      tickets: { n: 0 }
    })
  })

  it('each choice, mergedFrom, purge and delete run on DO SQLite', async () => {
    for (const choice of ['higher', 'mine', 'sum'] as CardChoice[]) {
      const name = `merge-${choice}`
      const meHash = await hash('me')
      const result = await inStore(name, (db) => {
        seed(db, meHash)
        const expected = cardTotal(db, 1, planCardMerge(db, 1, 2, choice))
        const now = new Date('2026-11-02T12:00:00.000Z')
        mergeAccounts(db, {
          survivor: 1,
          closed: 2,
          cards: choice,
          username: 'mine',
          moved: { provider: 'apple', subject: 'sub2' },
          appleRefreshToken: 'rt',
          now
        })
        const total = liveTotal(db, 1)
        const from = mergedFrom(db, 1)
        purgeHolds(db, new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000))
        const purged = db.prepare('SELECT purged_at FROM account_merges').get() as {
          purged_at: string | null
        }
        const closedLeft = db.prepare('SELECT count(*) AS n FROM users WHERE id = 2').get()
        deleteUserData(db, 1)
        const survivorLeft = db.prepare('SELECT count(*) AS n FROM users WHERE id = 1').get()
        return {
          expected,
          total,
          from,
          purged: purged.purged_at !== null,
          closedLeft,
          survivorLeft
        }
      })
      expect(result, choice).toEqual({
        expected: { higher: 11, mine: 5, sum: 14 }[choice as 'higher' | 'mine' | 'sum'],
        total: result.expected,
        from: [2],
        purged: true,
        closedLeft: { n: 0 },
        survivorLeft: { n: 0 }
      })
    }
  })
})
