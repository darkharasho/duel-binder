import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { browseCards } from '../../src/main/repo/browse'
import { listFavourites, setFavourite } from '../../src/main/repo/favourites'
import type { WireFavourite } from '../../src/shared/cloud'
import type { EntryView } from '../../src/shared/types'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import {
  applyFavouritePush,
  checkFavouritePush,
  favouritePullSince
} from '../../workers/portal/src/favourites'
import { acceptFriend, requestFriend } from '../../workers/portal/src/friends'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'

const NOW = new Date('2026-11-02T12:00:00.000Z')
const T1 = '2026-11-02T10:00:00.000Z'
const T2 = '2026-11-02T11:00:00.000Z'

interface P {
  id: number
  card_id: number
  image_id: number
}

describe('portal favourites', () => {
  let db: Database.Database
  let deps: AppDeps
  let me: number
  let bob: number
  let p: P
  let other: P

  const wire = (extra: Partial<WireFavourite> = {}): WireFavourite => ({
    cardId: p.card_id,
    game: 'ygo',
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
  const rpc = async (token: string, channel: string, ...args: unknown[]): Promise<Response> =>
    handle(
      new Request(`https://portal.test/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ args })
      }),
      deps
    )
  const result = async <T>(res: Response): Promise<T> =>
    ((await res.json()) as { result: T }).result

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
    const two = db
      .prepare(
        `SELECT p.id, p.card_id, i.image_id FROM card_printings p
           JOIN card_images i ON i.card_id = p.card_id WHERE p.game = 'ygo'
          GROUP BY p.card_id ORDER BY p.card_id LIMIT 2`
      )
      .all() as P[]
    ;[p, other] = two
    session(me, 'me-token', 'desktop')
    session(bob, 'bob-token', 'desktop')
  })

  describe('sync', () => {
    it('applies, keeps the latest edit, answers stale, and tombstones', () => {
      expect(applyFavouritePush(db, me, [wire({ updatedAt: T2 })], ['ygo'])).toEqual([
        { cardId: p.card_id, status: 'applied' }
      ])
      expect(applyFavouritePush(db, me, [wire({ deletedAt: T1 })], ['ygo'])).toEqual([
        {
          cardId: p.card_id,
          status: 'stale',
          current: expect.objectContaining({ updatedAt: T2, deletedAt: null })
        }
      ])
      applyFavouritePush(db, me, [wire({ deletedAt: T2, updatedAt: T2 })], ['ygo'])
      expect(favouritePullSince(db, me, 0).entries).toMatchObject([{ deletedAt: T2 }])
      expect(listFavourites(db, userScope(me, 'ygo'))).toEqual([])
    })

    it('an identical push writes nothing, and a delete of nothing stores nothing', () => {
      applyFavouritePush(db, me, [wire()], ['ygo'])
      const { cursor } = favouritePullSince(db, me, 0)
      applyFavouritePush(db, me, [wire()], ['ygo'])
      expect(favouritePullSince(db, me, cursor).entries).toEqual([])
      applyFavouritePush(db, me, [wire({ cardId: other.card_id, deletedAt: T1 })], ['ygo'])
      expect(favouritePullSince(db, me, 0).entries).toHaveLength(1)
    })

    it('users have separate rows for one card, and skip a game they can not use', () => {
      applyFavouritePush(db, me, [wire()], ['ygo'])
      expect(favouritePullSince(db, bob, 0).entries).toEqual([])
      expect(applyFavouritePush(db, bob, [wire({ game: 'pkm' })], ['ygo'])).toEqual([
        { cardId: p.card_id, status: 'skipped' }
      ])
      expect(favouritePullSince(db, bob, 0, 10, 'pkm').entries).toEqual([])
    })

    it('pulls per game and pages', () => {
      applyFavouritePush(
        db,
        me,
        [wire({ cardId: 1 }), wire({ cardId: 2, game: 'pkm' }), wire({ cardId: 3 })],
        ['ygo', 'pkm']
      )
      const page1 = favouritePullSince(db, me, 0, 1, 'ygo')
      expect(page1).toMatchObject({ more: true, entries: [{ cardId: 1 }] })
      const page2 = favouritePullSince(db, me, page1.cursor, 1, 'ygo')
      expect(page2).toMatchObject({ more: false, entries: [{ cardId: 3 }], cursor: 3 })
    })

    it('validates a push', () => {
      const check = (v: unknown): unknown => checkFavouritePush({ entries: [v] }, NOW)
      expect(check(wire())).toEqual([wire()])
      for (const bad of [
        wire({ cardId: 0 }),
        wire({ cardId: 1.5 }),
        wire({ cardId: '1' as never }),
        wire({ game: 'mtg' as never }),
        wire({ updatedAt: 'nope' })
      ])
        expect(() => check(bad)).toThrow()
      expect(() => checkFavouritePush({}, NOW)).toThrow()
    })

    it('the routes want a desktop token, and an over-long push is refused', async () => {
      const post = (token: string, entries: unknown): Promise<Response> =>
        handle(
          new Request('https://portal.test/api/sync/favourites-push', {
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
        new Request('https://portal.test/api/sync/favourites-pull?cursor=0&game=ygo', {
          headers: { authorization: 'Bearer me-token' }
        }),
        deps
      )
      expect(((await pull.json()) as { entries: unknown[] }).entries).toHaveLength(1)
    })
  })

  describe('the web, through the RPC', () => {
    it('hearts, lists and unhearts, scoped to the caller; the sync feed carries it', async () => {
      expect((await rpc('me-token', 'favourites:set', p.card_id, true)).status).toBe(200)
      expect(await result(await rpc('me-token', 'favourites:list'))).toEqual([p.card_id])
      expect(await result(await rpc('bob-token', 'favourites:list'))).toEqual([])
      await rpc('me-token', 'favourites:set', p.card_id, false)
      expect(listFavourites(db, userScope(me, 'ygo'))).toEqual([])
      expect(favouritePullSince(db, me, 0).entries).toMatchObject([
        { cardId: p.card_id, deletedAt: NOW.toISOString() }
      ])
    })

    it('refuses an unknown card or a non-boolean', async () => {
      expect((await rpc('me-token', 'favourites:set', 999_999_999, true)).status).toBe(400)
      expect((await rpc('me-token', 'favourites:set', p.card_id, 'yes')).status).toBe(400)
    })

    it('the Favourites filter limits the collection and Browse to hearted cards', () => {
      const scope = userScope(me, 'ygo')
      for (const c of [p, other])
        addEntry(db, { printingId: c.id, imageId: c.image_id, quantity: 1 }, NOW, scope)
      setFavourite(db, p.card_id, true, NOW, scope)
      const owned = listEntries(db, { sort: 'name', dir: 'asc', favourites: true }, scope)
      expect(owned.map((e) => e.card.id)).toEqual([p.card_id])
      const browsed = browseCards(db, { sort: 'name', dir: 'asc', favourites: true }, scope)
      expect(browsed.cards.map((c) => c.id)).toEqual([p.card_id])
      expect(browsed.total).toBe(1)
    })

    it("a friend's favourites never filter what the caller sees", async () => {
      requestFriend(db, me, 'bob', NOW)
      acceptFriend(db, bob, me, NOW)
      const bobs = userScope(bob, 'ygo')
      for (const c of [p, other])
        addEntry(db, { printingId: c.id, imageId: c.image_id, quantity: 1 }, NOW, bobs)
      setFavourite(db, p.card_id, true, NOW, bobs)
      const res = await rpc('me-token', 'friends:collection', bob, {
        sort: 'name',
        dir: 'asc',
        favourites: true
      })
      expect(res.status).toBe(200)
      const seen = await result<EntryView[]>(res)
      expect(seen.map((e) => e.card.id).sort()).toEqual([p.card_id, other.card_id].sort())
    })
  })

  it('a deleted account takes its favourites with it', async () => {
    setFavourite(db, p.card_id, true, NOW, userScope(me, 'ygo'))
    const res = await handle(
      new Request('https://portal.test/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer me-token' },
        body: JSON.stringify({ confirm: 'delete' })
      }),
      deps
    )
    expect(res.status).toBe(204)
    expect(db.prepare('SELECT COUNT(*) AS n FROM favourites').get()).toEqual({ n: 0 })
  })

  it('reads stay on indexes', () => {
    const plan = (sql: string, ...args: unknown[]): string =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[])
        .map((r) => r.detail)
        .join('\n')
    expect(
      plan('SELECT * FROM favourites WHERE user_id = ? AND game = ? AND seq > ?', me, 'ygo', 0)
    ).not.toMatch(/SCAN favourites\b/)
    expect(
      plan(
        `SELECT f.card_id FROM favourites f WHERE ${userScope(me, 'ygo').where('f')} ORDER BY f.card_id`
      )
    ).not.toMatch(/SCAN f\b/)
  })
})
