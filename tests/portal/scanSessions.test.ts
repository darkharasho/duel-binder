import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { CollectionError } from '../../src/main/repo/collection'
import {
  MAX_SESSION_CARDS,
  type ScanSessionCard,
  type WireScanSession
} from '../../src/shared/scanSessions'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { deleteUserData } from '../../workers/portal/src/account'
import { mergeAccounts } from '../../workers/portal/src/merge'
import {
  applySessionPush,
  checkSessionPush,
  friendSessions,
  sessionPullSince
} from '../../workers/portal/src/scanSessions'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'

const NOW = new Date('2026-11-05T12:00:00.000Z')
const T1 = '2026-11-05T10:00:00.000Z'
const T2 = '2026-11-05T11:00:00.000Z'
const BOTH = ['ygo', 'pkm'] as const
const BASE = 'https://portal.test'

const card = (extra: Partial<ScanSessionCard> = {}): ScanSessionCard => ({
  cardId: 1,
  printingId: 2,
  imageId: 3,
  photoId: null,
  name: 'Dark Magician',
  setCode: 'LOB-005',
  rarity: 'Ultra Rare',
  quantity: 1,
  price: 4.5,
  guess: false,
  addedAt: 1_762_340_000_000,
  ...extra
})
const session = (extra: Partial<WireScanSession> = {}): WireScanSession => ({
  uid: 's1',
  game: 'ygo',
  cards: [card()],
  friendsVisible: true,
  createdAt: T1,
  updatedAt: T1,
  deletedAt: null,
  ...extra
})

describe('portal scan sessions', () => {
  let db: Database.Database
  let deps: AppDeps
  let me: number
  let bob: number

  beforeEach(async () => {
    db = await seededServerDb()
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
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
    bob = addUser(db, 'apple:bob-sub', 'bob')
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      createHash('sha256').update('me-token').digest('hex'),
      me,
      'desktop',
      NOW.toISOString(),
      '2999-01-01T00:00:00.000Z'
    )
  })

  it('push then pull round-trips, per game, with tombstones', () => {
    expect(applySessionPush(db, me, [session(), session({ uid: 'p', game: 'pkm' })], BOTH)).toEqual(
      [
        { uid: 's1', status: 'applied' },
        { uid: 'p', status: 'applied' }
      ]
    )
    const pull = sessionPullSince(db, me, 'ygo', 0)
    expect(pull).toEqual({ sessions: [session()], cursor: 2, more: false })
    applySessionPush(db, me, [session({ updatedAt: T2, deletedAt: T2 })], BOTH)
    expect(sessionPullSince(db, me, 'ygo', pull.cursor).sessions).toMatchObject([{ deletedAt: T2 }])
  })

  it('an older push is stale and carries the current row; same push is applied', () => {
    applySessionPush(db, me, [session({ friendsVisible: false, updatedAt: T2 })], BOTH)
    expect(applySessionPush(db, me, [session()], BOTH)).toEqual([
      { uid: 's1', status: 'stale', current: session({ friendsVisible: false, updatedAt: T2 }) }
    ])
    expect(
      applySessionPush(db, me, [session({ friendsVisible: false, updatedAt: T2 })], BOTH)
    ).toEqual([{ uid: 's1', status: 'applied' }])
  })

  it('a newer push with a null price keeps the stored price', () => {
    applySessionPush(db, me, [session()], BOTH)
    applySessionPush(
      db,
      me,
      [session({ cards: [card({ price: null })], friendsVisible: false, updatedAt: T2 })],
      BOTH
    )
    const [row] = sessionPullSince(db, me, 'ygo', 0).sessions
    expect(row.cards[0].price).toBe(4.5)
    expect(row).toMatchObject({ friendsVisible: false, updatedAt: T2 })
  })

  it('a newer push with a different price keeps the stored price', () => {
    applySessionPush(db, me, [session()], BOTH)
    applySessionPush(db, me, [session({ cards: [card({ price: 9 })], updatedAt: T2 })], BOTH)
    expect(sessionPullSince(db, me, 'ygo', 0).sessions[0].cards[0].price).toBe(4.5)
  })

  it('a newer push fills a stored null', () => {
    applySessionPush(db, me, [session({ cards: [card({ price: null })] })], BOTH)
    applySessionPush(db, me, [session({ cards: [card({ price: 7 })], updatedAt: T2 })], BOTH)
    expect(sessionPullSince(db, me, 'ygo', 0).sessions[0].cards[0].price).toBe(7)
  })

  it('a key order difference is still the same push', () => {
    applySessionPush(db, me, [session()], BOTH)
    const { uid, game, cards, friendsVisible, createdAt, updatedAt, deletedAt } = session()
    const shuffled = {
      deletedAt,
      updatedAt,
      createdAt,
      friendsVisible,
      cards: [{ ...card() }],
      game,
      uid
    }
    expect(applySessionPush(db, me, [shuffled], BOTH)).toEqual([{ uid: 's1', status: 'applied' }])
    expect(cards.length).toBe(1)
  })

  it('skips a game outside games and does not store a tombstone for an unknown uid', () => {
    expect(applySessionPush(db, me, [session({ game: 'pkm' })], ['ygo'])).toEqual([
      { uid: 's1', status: 'skipped' }
    ])
    applySessionPush(db, me, [session({ deletedAt: T1 })], BOTH)
    expect(sessionPullSince(db, me, 'ygo', 0).sessions).toEqual([])
  })

  it('refuses a bad card, too many cards and malformed fields', () => {
    const check = (s: unknown): WireScanSession[] => checkSessionPush({ entries: [s] }, NOW)
    expect(check(session())).toEqual([session()])
    expect(() => check(session({ cards: [card({ quantity: 0 })] }))).toThrow(CollectionError)
    expect(() => check(session({ cards: [] }))).toThrow(CollectionError)
    expect(() =>
      check(session({ cards: Array.from({ length: MAX_SESSION_CARDS + 1 }, () => card()) }))
    ).toThrow(CollectionError)
    expect(() => check(session({ uid: '' }))).toThrow(CollectionError)
    expect(() => check({ ...session(), friendsVisible: 'yes' })).toThrow(CollectionError)
    expect(() => check(session({ createdAt: 'nope' }))).toThrow(CollectionError)
    expect(() => checkSessionPush({}, NOW)).toThrow(CollectionError)
  })

  it('friendSessions shows visible, live sessions of that game, newest first', () => {
    applySessionPush(
      db,
      bob,
      [
        session({ uid: 'old' }),
        session({ uid: 'new', createdAt: T2, updatedAt: T2 }),
        session({ uid: 'hidden', friendsVisible: false }),
        session({ uid: 'other', game: 'pkm' }),
        session({ uid: 'gone' })
      ],
      BOTH
    )
    applySessionPush(db, bob, [session({ uid: 'gone', updatedAt: T2, deletedAt: T2 })], BOTH)
    const list = friendSessions(db, bob, 'ygo')
    expect(list.map((s) => s.uid)).toEqual(['new', 'old'])
    expect(list[0]).not.toHaveProperty('deletedAt')
    expect(friendSessions(db, me, 'ygo')).toEqual([])
  })

  it('syncs over the routes and friends:sessions needs a friendship', async () => {
    const post = (body: unknown): Promise<Response> =>
      handle(
        new Request(`${BASE}/api/sync/sessions-push`, {
          method: 'POST',
          headers: { authorization: 'Bearer me-token', 'content-type': 'application/json' },
          body: JSON.stringify(body)
        }),
        deps
      )
    const res = await post({ entries: [session()] })
    expect(await res.json()).toEqual({ results: [{ uid: 's1', status: 'applied' }] })
    expect((await post({ entries: [session({ cards: [card({ price: -1 })] })] })).status).toBe(400)
    const pull = await handle(
      new Request(`${BASE}/api/sync/sessions-pull?cursor=0&game=ygo`, {
        headers: { authorization: 'Bearer me-token' }
      }),
      deps
    )
    expect(await pull.json()).toEqual({ sessions: [session()], cursor: 1, more: false })
    const rpc = await handle(
      new Request(`${BASE}/api/rpc/friends:sessions`, {
        method: 'POST',
        headers: { authorization: 'Bearer me-token', 'content-type': 'application/json' },
        body: JSON.stringify({ args: [bob] })
      }),
      deps
    )
    expect(rpc.status).toBe(400)
  })

  it('account delete removes the rows; merge copies live ones', () => {
    applySessionPush(db, bob, [session(), session({ uid: 'gone' })], BOTH)
    applySessionPush(db, bob, [session({ uid: 'gone', updatedAt: T2, deletedAt: T2 })], BOTH)
    applySessionPush(db, me, [session({ uid: 'mine', friendsVisible: false })], BOTH)
    mergeAccounts(db, {
      survivor: me,
      closed: bob,
      cards: 'higher',
      username: 'mine',
      moved: { provider: 'apple', subject: 'bob-sub' },
      appleRefreshToken: null,
      now: NOW
    } as never)
    const merged = sessionPullSince(db, me, 'ygo', 0).sessions
    expect(merged.map((s) => s.uid).sort()).toEqual(['mine', 's1'])
    expect(merged.find((s) => s.uid === 's1')?.cards).toEqual([card()])
    // The closed account's rows are held, not deleted, until the hold lapses.
    expect(sessionPullSince(db, bob, 'ygo', 0).sessions.length).toBe(2)
    deleteUserData(db, bob)
    deleteUserData(db, me)
    expect(db.prepare('SELECT count(*) AS n FROM scan_sessions').get()).toEqual({ n: 0 })
  })
})
