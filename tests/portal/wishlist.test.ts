import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addEntry, removeEntry } from '../../src/main/repo/collection'
import { listWishlist, setWish, settleWishlist, wishesForCard } from '../../src/main/repo/wishlist'
import type { WireWish } from '../../src/shared/cloud'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import {
  acceptFriend,
  blockUser,
  removeFriend,
  requestFriend
} from '../../workers/portal/src/friends'
import { userScope } from '../../workers/portal/src/scope'
import {
  applyWishPush,
  checkWishPush,
  friendWishlist,
  friendsOwning,
  friendsWanting,
  setWishlistVisible,
  wishPullSince,
  wishlistVisible
} from '../../workers/portal/src/wishlist'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'
import { createHash } from 'node:crypto'

const NOW = new Date('2026-10-24T12:00:00.000Z')
const T1 = '2026-10-24T10:00:00.000Z'
const T2 = '2026-10-24T11:00:00.000Z'

interface P {
  id: number
  pkey: string
  card_id: number
  image_id: number
}

describe('portal wishlists', () => {
  let db: Database.Database
  let deps: AppDeps
  let me: number
  let bob: number
  let carol: number
  let p: P

  const befriend = (name: string, id: number): void => {
    requestFriend(db, me, name, NOW)
    acceptFriend(db, id, me, NOW)
  }
  const want = (user: number, quantity: number | null = null): void =>
    setWish(db, p.id, quantity, NOW, userScope(user, 'ygo'))
  const give = (user: number, quantity = 1): number =>
    addEntry(db, { printingId: p.id, imageId: p.image_id, quantity }, NOW, userScope(user, 'ygo'))
      .id
  const wire = (extra: Partial<WireWish> = {}): WireWish => ({
    pkey: p.pkey,
    game: 'ygo',
    quantity: null,
    createdAt: T1,
    updatedAt: T1,
    deletedAt: null,
    ...extra
  })

  const session = (userId: number, token: string, kind: string): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      createHash('sha256').update(token).digest('hex'),
      userId,
      kind,
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
  }
  const rpc = (token: string, channel: string, ...args: unknown[]): Promise<Response> =>
    handle(
      new Request(`https://portal.test/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ args })
      }),
      deps
    )

  beforeEach(async () => {
    db = await seededServerDb()
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: 'https://portal.test',
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => NOW,
      fetch: fetch
    } as AppDeps
    me = addUser(db, '1', 'me')
    bob = addUser(db, '2', 'bob')
    carol = addUser(db, '3', 'carol')
    p = db
      .prepare(
        `SELECT p.id, p.pkey, p.card_id, i.image_id FROM card_printings p
           JOIN card_images i ON i.card_id = p.card_id WHERE p.game = 'ygo' LIMIT 1`
      )
      .get() as P
    session(me, 'me-token', 'desktop')
    session(bob, 'bob-token', 'desktop')
    session(carol, 'carol-token', 'desktop')
  })

  describe("reading a friend's list", () => {
    it('an accepted friend reads it, over the RPC', async () => {
      befriend('bob', bob)
      want(bob, 2)
      const res = await rpc('me-token', 'friends:wishlist', bob)
      expect(res.status).toBe(200)
      expect(((await res.json()) as { result: unknown }).result).toMatchObject([
        { pkey: p.pkey, quantity: 2, owned: 0 }
      ])
    })

    it('a non-friend is refused', async () => {
      want(bob)
      const res = await rpc('carol-token', 'friends:wishlist', bob)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "You aren't friends with this user" })
    })

    it('a pending request is not a friendship', async () => {
      want(bob)
      requestFriend(db, me, 'bob', NOW)
      expect((await rpc('me-token', 'friends:wishlist', bob)).status).toBe(400)
      expect((await rpc('bob-token', 'friends:wishlist', me)).status).toBe(400)
    })

    it('a block cuts both ways, and so does ending the friendship', async () => {
      befriend('bob', bob)
      want(bob)
      want(me)
      blockUser(db, bob, me, NOW)
      expect((await rpc('me-token', 'friends:wishlist', bob)).status).toBe(400)
      expect((await rpc('bob-token', 'friends:wishlist', me)).status).toBe(400)
      expect(friendsWanting(db, me, 'ygo', p.card_id)).toEqual([])
      expect(friendsWanting(db, bob, 'ygo', p.card_id)).toEqual([])

      befriend('carol', carol)
      want(carol)
      removeFriend(db, me, carol)
      expect((await rpc('me-token', 'friends:wishlist', carol)).status).toBe(400)
    })

    it('privacy off: an empty list and no "wants this", until turned back on', async () => {
      befriend('bob', bob)
      want(bob)
      expect(wishlistVisible(db, bob)).toBe(true)
      setWishlistVisible(db, bob, false)
      const res = await rpc('me-token', 'friends:wishlist', bob)
      expect(((await res.json()) as { result: unknown }).result).toEqual([])
      expect(friendsWanting(db, me, 'ygo', p.card_id)).toEqual([])
      // Their own list is untouched.
      expect(listWishlist(db, userScope(bob, 'ygo'))).toHaveLength(1)

      setWishlistVisible(db, bob, true)
      expect(friendWishlist(db, bob, 'ygo')).toHaveLength(1)
      expect(friendsWanting(db, me, 'ygo', p.card_id)).toHaveLength(1)
    })

    it('privacy is set over the RPC and refuses anything but a boolean', async () => {
      const res = await rpc('bob-token', 'friends:setWishlistVisible', false)
      expect(res.status).toBe(200)
      expect(wishlistVisible(db, bob)).toBe(false)
      expect((await rpc('bob-token', 'friends:setWishlistVisible', 'no')).status).toBe(400)
      const read = await rpc('bob-token', 'friends:wishlistVisible')
      expect(((await read.json()) as { result: unknown }).result).toBe(false)
    })

    it('leaves out what the friend already has', () => {
      befriend('bob', bob)
      want(bob, 3)
      const id = give(bob, 2)
      expect(friendWishlist(db, bob, 'ygo')).toHaveLength(1)
      expect(friendsWanting(db, me, 'ygo', p.card_id)).toHaveLength(1)
      removeEntry(db, id, NOW, userScope(bob, 'ygo'))
      db.prepare('UPDATE wishlist_entries SET quantity = NULL WHERE user_id = ?').run(bob)
      give(bob, 1)
      expect(friendWishlist(db, bob, 'ygo')).toEqual([])
      expect(friendsWanting(db, me, 'ygo', p.card_id)).toEqual([])
    })

    it('a friend who wants a card names its printings, with no one else in the answer', () => {
      befriend('bob', bob)
      want(bob)
      want(carol)
      expect(friendsWanting(db, me, 'ygo', p.card_id)).toMatchObject([
        { id: bob, username: 'bob', printings: [{ setCode: expect.any(String) }] }
      ])
    })
  })

  describe('friendsOwning', () => {
    it('answers in one call which friends own which printings', () => {
      befriend('bob', bob)
      give(bob, 2)
      give(carol, 1)
      expect(friendsOwning(db, me, 'ygo', [p.pkey, 'en|0|NOPE|Rare'])).toMatchObject([
        { pkey: p.pkey, friends: [{ id: bob, quantity: 2 }] }
      ])
    })

    it('ignores tombstones and non-friends', () => {
      const id = give(bob, 2)
      expect(friendsOwning(db, me, 'ygo', [p.pkey])).toEqual([])
      befriend('bob', bob)
      removeEntry(db, id, NOW, userScope(bob, 'ygo'))
      expect(friendsOwning(db, me, 'ygo', [p.pkey])).toEqual([])
    })

    it('refuses a bad list', () => {
      expect(() => friendsOwning(db, me, 'ygo', 'x')).toThrow()
      expect(() => friendsOwning(db, me, 'ygo', [1])).toThrow()
      expect(() => friendsOwning(db, me, 'ygo', Array(1001).fill('a'))).toThrow()
    })
  })

  describe('the web, through the RPC', () => {
    it('wants, lists and removes, scoped to the caller', async () => {
      expect((await rpc('me-token', 'wishlist:set', p.id, 2)).status).toBe(200)
      expect(wishesForCard(db, p.card_id, userScope(me, 'ygo'))).toEqual([
        { printingId: p.id, quantity: 2 }
      ])
      expect(wishesForCard(db, p.card_id, userScope(bob, 'ygo'))).toEqual([])
      expect((await rpc('bob-token', 'wishlist:remove', p.id)).status).toBe(200)
      expect(listWishlist(db, userScope(me, 'ygo'))).toHaveLength(1)
      await rpc('me-token', 'wishlist:remove', p.id)
      expect(listWishlist(db, userScope(me, 'ygo'))).toEqual([])
    })

    it('an add that meets the target removes the want, and the sync feed carries it', async () => {
      want(me, 1)
      const cursor = wishPullSince(db, me, 0).cursor
      await rpc('me-token', 'collection:add', {
        printingId: p.id,
        imageId: p.image_id,
        quantity: 1
      })
      expect(listWishlist(db, userScope(me, 'ygo'))).toEqual([])
      expect(wishPullSince(db, me, cursor).entries).toMatchObject([
        { pkey: p.pkey, deletedAt: NOW.toISOString() }
      ])
    })
  })

  it('settling several wants at once gives each its own seq', async () => {
    const second = db
      .prepare(
        `SELECT p.id, p.pkey, p.card_id, i.image_id FROM card_printings p
           JOIN card_images i ON i.card_id = p.card_id WHERE p.game = 'ygo' AND p.id <> ? LIMIT 1`
      )
      .get(p.id) as P
    // Copies that came from an old app, which never settles: both targets are already met.
    for (const x of [p, second]) {
      addEntry(
        db,
        { printingId: x.id, imageId: x.image_id, quantity: 1 },
        NOW,
        userScope(me, 'ygo')
      )
      applyWishPush(db, me, [wire({ pkey: x.pkey, quantity: 1 })], ['ygo'])
    }
    const res = await rpc('me-token', 'collection:update', 1, { quantity: 1 })
    expect(res.status).not.toBe(500)
    expect(settleWishlist(db, userScope(me, 'ygo'), NOW)).toBeLessThanOrEqual(2)
    expect(listWishlist(db, userScope(me, 'ygo'))).toEqual([])
    const seqs = db.prepare('SELECT seq FROM wishlist_entries').all() as { seq: number }[]
    expect(new Set(seqs.map((r) => r.seq)).size).toBe(2)
  })

  describe('sync', () => {
    it('applies, keeps the latest edit, answers stale, and tombstones', () => {
      expect(applyWishPush(db, me, [wire({ updatedAt: T2 })], ['ygo'])).toEqual([
        { pkey: p.pkey, status: 'applied' }
      ])
      expect(applyWishPush(db, me, [wire({ quantity: 5 })], ['ygo'])).toEqual([
        {
          pkey: p.pkey,
          status: 'stale',
          current: expect.objectContaining({ updatedAt: T2, quantity: null })
        }
      ])
      applyWishPush(db, me, [wire({ deletedAt: T2, updatedAt: T2 })], ['ygo'])
      expect(wishPullSince(db, me, 0).entries).toMatchObject([{ deletedAt: T2 }])
    })

    it('an identical push writes nothing, and a delete of nothing stores nothing', () => {
      applyWishPush(db, me, [wire()], ['ygo'])
      const { cursor } = wishPullSince(db, me, 0)
      applyWishPush(db, me, [wire()], ['ygo'])
      expect(wishPullSince(db, me, cursor).entries).toEqual([])
      applyWishPush(db, me, [wire({ pkey: 'en|1|X|Rare', deletedAt: T1 })], ['ygo'])
      expect(wishPullSince(db, me, 0).entries).toHaveLength(1)
    })

    it('users have separate rows for one printing', () => {
      applyWishPush(db, me, [wire({ quantity: 1 })], ['ygo'])
      applyWishPush(db, bob, [wire({ quantity: 2 })], ['ygo'])
      expect(wishPullSince(db, me, 0).entries).toMatchObject([{ quantity: 1 }])
      expect(wishPullSince(db, bob, 0).entries).toMatchObject([{ quantity: 2 }])
    })

    it('skips a game the user can not use, and keeps it out of the table', () => {
      expect(applyWishPush(db, me, [wire({ game: 'pkm' })], ['ygo'])).toEqual([
        { pkey: p.pkey, status: 'skipped' }
      ])
      expect(wishPullSince(db, me, 0, 10, 'pkm').entries).toEqual([])
    })

    it('pulls per game, moving past the other game and paging', () => {
      applyWishPush(
        db,
        me,
        [wire({ pkey: 'a' }), wire({ pkey: 'b', game: 'pkm' }), wire({ pkey: 'c' })],
        ['ygo', 'pkm']
      )
      const page1 = wishPullSince(db, me, 0, 1, 'ygo')
      expect(page1).toMatchObject({ more: true, entries: [{ pkey: 'a' }] })
      const page2 = wishPullSince(db, me, page1.cursor, 1, 'ygo')
      expect(page2).toMatchObject({ more: false, entries: [{ pkey: 'c' }], cursor: 3 })
    })

    it('validates a push', () => {
      const check = (v: unknown): unknown => checkWishPush({ entries: [v] }, NOW)
      expect(check(wire())).toEqual([wire()])
      for (const bad of [
        wire({ pkey: '' }),
        wire({ game: 'mtg' as never }),
        wire({ quantity: 0 }),
        wire({ quantity: 1000 }),
        wire({ quantity: 1.5 }),
        wire({ updatedAt: 'nope' })
      ])
        expect(() => check(bad)).toThrow()
      expect(() => checkWishPush({}, NOW)).toThrow()
    })

    it('the routes want a desktop token, and an over-long push is refused', async () => {
      const post = (token: string, entries: unknown): Promise<Response> =>
        handle(
          new Request('https://portal.test/api/sync/wishlist-push', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ entries })
          }),
          deps
        )
      expect((await post('nobody', [])).status).toBe(401)
      expect((await post('me-token', Array(501).fill(wire()))).status).toBe(413)
      expect((await post('me-token', [wire()])).status).toBe(200)
      const pull = await handle(
        new Request('https://portal.test/api/sync/wishlist-pull?cursor=0&game=ygo', {
          headers: { authorization: 'Bearer me-token' }
        }),
        deps
      )
      expect(((await pull.json()) as { entries: unknown[] }).entries).toHaveLength(1)
    })
  })

  it('a deleted account takes its wishlist with it', async () => {
    want(me)
    const res = await handle(
      new Request('https://portal.test/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer me-token' },
        body: JSON.stringify({ confirm: 'delete' })
      }),
      deps
    )
    expect(res.status).toBe(204)
    expect(db.prepare('SELECT COUNT(*) AS n FROM wishlist_entries').get()).toEqual({ n: 0 })
  })

  it('server-15 only adds: an old user row keeps working and starts visible', () => {
    expect(wishlistVisible(db, me)).toBe(true)
    const cols = db.prepare('PRAGMA table_info(users)').all() as {
      name: string
      notnull: number
      dflt_value: string
    }[]
    expect(cols.find((c) => c.name === 'wishlist_hidden')).toMatchObject({ dflt_value: '0' })
  })

  it('reads stay on indexes: no full scan of a big table', () => {
    const plan = (sql: string, ...args: unknown[]): string =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[])
        .map((r) => r.detail)
        .join('\n')
    const list = plan(
      `SELECT p.id FROM wishlist_entries w JOIN card_printings p ON p.pkey = w.pkey
       WHERE w.user_id = ? AND w.game = 'ygo' AND w.deleted_at IS NULL`,
      me
    )
    expect(list).not.toMatch(/SCAN p\b/)
    expect(list).toMatch(/ux_printings_pkey/)
  })
})
