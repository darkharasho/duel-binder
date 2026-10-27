import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const NOW = '2026-10-24T12:00:00.000Z'
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('POST /api/account/delete', () => {
  let db: Database.Database
  let deps: AppDeps
  let alice: number
  let bob: number
  let carol: number

  const addSession = (token: string, userId: number, kind: 'web' | 'desktop'): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(sha256Hex(token), userId, kind, NOW, new Date(Date.parse(NOW) + 30 * DAY).toISOString())
  }

  /** Gives a user one of every kind of row the server keeps for them. */
  const fill = (userId: number, tag: string, printingId: number, imageId: number): void => {
    db.prepare(
      `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at, updated_at, server_seq)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(userId, `uid-${tag}`, printingId, imageId, NOW, NOW, userId * 100)
    db.prepare(
      'INSERT INTO value_snapshots (user_id, date, total_value, total_cards) VALUES (?, ?, 1.5, 1)'
    ).run(userId, '2026-10-24')
    db.prepare('INSERT INTO friend_request_log (user_id, created_at) VALUES (?, ?)').run(userId, NOW)
    db.prepare(
      'INSERT INTO desktop_codes (code_hash, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)'
    ).run(`code-${tag}`, userId, 'c', '2026-10-24T12:02:00.000Z')
  }

  const counts = (userId: number): Record<string, number> => {
    const n = (sql: string, ...args: unknown[]): number =>
      (db.prepare(sql).get(...args) as { n: number }).n
    return {
      users: n('SELECT count(*) AS n FROM users WHERE id = ?', userId),
      collection_entries: n('SELECT count(*) AS n FROM collection_entries WHERE user_id = ?', userId),
      value_snapshots: n('SELECT count(*) AS n FROM value_snapshots WHERE user_id = ?', userId),
      sessions: n('SELECT count(*) AS n FROM sessions WHERE user_id = ?', userId),
      desktop_codes: n('SELECT count(*) AS n FROM desktop_codes WHERE user_id = ?', userId),
      friendships: n(
        'SELECT count(*) AS n FROM friendships WHERE requester_id = ? OR addressee_id = ?',
        userId,
        userId
      ),
      friend_request_log: n('SELECT count(*) AS n FROM friend_request_log WHERE user_id = ?', userId),
      friend_blocks: n(
        'SELECT count(*) AS n FROM friend_blocks WHERE blocker_id = ? OR blocked_id = ?',
        userId,
        userId
      ),
      printing_contributions: n(
        'SELECT count(*) AS n FROM printing_contributions WHERE user_id = ?',
        userId
      )
    }
  }

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '111', 'alice')
    bob = addUser(db, '222', 'bob')
    carol = addUser(db, '333', 'carol')
    const printings = (
      db.prepare('SELECT id FROM card_printings ORDER BY id LIMIT 3').all() as { id: number }[]
    ).map((r) => r.id)
    const img = (db.prepare('SELECT image_id FROM card_images LIMIT 1').get() as { image_id: number })
      .image_id
    fill(alice, 'a', printings[0], img)
    fill(bob, 'b', printings[0], img)
    const friend = db.prepare(
      "INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, 'accepted', ?, ?)"
    )
    friend.run(alice, bob, NOW, NOW)
    friend.run(bob, carol, NOW, NOW)
    const block = db.prepare(
      'INSERT INTO friend_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)'
    )
    block.run(carol, alice, NOW)
    block.run(carol, bob, NOW)
    const contribute = db.prepare(
      'INSERT INTO printing_contributions (printing_id, user_id, created_at) VALUES (?, ?, ?)'
    )
    contribute.run(printings[1], alice, NOW)
    contribute.run(printings[2], bob, NOW)
    addSession('alice-web', alice, 'web')
    addSession('alice-desktop', alice, 'desktop')
    addSession('bob-web', bob, 'web')
    addSession('bob-desktop', bob, 'desktop')
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'cid',
        DISCORD_CLIENT_SECRET: 'secret',
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => new Date(NOW),
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const del = (headers: Record<string, string>, body: unknown = { confirm: 'delete' }): Promise<Response> =>
    handle(
      new Request(BASE + '/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      }),
      deps
    )

  it("delete removes the user's rows and every session", async () => {
    const bobBefore = counts(bob)
    const carolBefore = counts(carol)
    const res = await del({ origin: BASE, cookie: 'session=alice-web' })
    expect(res.status).toBe(204)
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith('session='))
    expect(cleared).toMatch(/^session=;.*Max-Age=0/)
    expect(Object.values(counts(alice)).every((n) => n === 0)).toBe(true)
    expect(counts(alice)).toEqual({
      users: 0,
      collection_entries: 0,
      value_snapshots: 0,
      sessions: 0,
      desktop_codes: 0,
      friendships: 0,
      friend_request_log: 0,
      friend_blocks: 0,
      printing_contributions: 0
    })
    // Bob loses only his friendship with Alice; Carol loses only her block on Alice.
    expect(counts(bob)).toEqual({ ...bobBefore, friendships: bobBefore.friendships - 1 })
    expect(counts(carol)).toEqual({ ...carolBefore, friend_blocks: carolBefore.friend_blocks - 1 })
    expect(counts(bob).sessions).toBe(2)
  })

  it('a Bearer token deletes the account without an Origin', async () => {
    const res = await del({ authorization: 'Bearer alice-desktop' })
    expect(res.status).toBe(204)
    expect(counts(alice).users).toBe(0)
    expect(counts(bob).users).toBe(1)
  })

  it("a deleted user's Bearer token gets 401 on sync", async () => {
    expect((await del({ authorization: 'Bearer alice-desktop' })).status).toBe(204)
    const pull = await handle(
      new Request(BASE + '/api/sync/pull?cursor=0', { headers: { authorization: 'Bearer alice-desktop' } }),
      deps
    )
    expect(pull.status).toBe(401)
    const bobPull = await handle(
      new Request(BASE + '/api/sync/pull?cursor=0', { headers: { authorization: 'Bearer bob-desktop' } }),
      deps
    )
    expect(bobPull.status).toBe(200)
  })

  it('signed out is a 401', async () => {
    expect((await del({ origin: BASE })).status).toBe(401)
    expect((await del({ origin: BASE, cookie: 'session=nope' })).status).toBe(401)
    expect((await del({ authorization: 'Bearer nope' })).status).toBe(401)
    expect(counts(alice).users).toBe(1)
  })

  it('wrong confirm is a 400', async () => {
    for (const body of [{}, { confirm: 'yes' }, { confirm: 'DELETE' }, 'not json', [], null]) {
      const res = await del({ origin: BASE, cookie: 'session=alice-web' }, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'confirm' })
    }
    expect(counts(alice)).toMatchObject({ users: 1, sessions: 2, collection_entries: 1 })
  })

  it('foreign Origin with a cookie is a 403', async () => {
    for (const origin of ['https://evil.test', 'http://portal.test', 'null']) {
      expect((await del({ origin, cookie: 'session=alice-web' })).status).toBe(403)
    }
    // No Origin at all is refused too.
    expect((await del({ cookie: 'session=alice-web' })).status).toBe(403)
    expect(counts(alice)).toMatchObject({ users: 1, sessions: 2 })
  })

  it('only answers POST', async () => {
    const res = await handle(
      new Request(BASE + '/api/account/delete', { headers: { authorization: 'Bearer alice-desktop' } }),
      deps
    )
    expect(res.status).toBe(405)
    expect(counts(alice).users).toBe(1)
  })
})
