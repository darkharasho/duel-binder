import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { mergeAccounts, purgeHolds } from '../../workers/portal/src/merge'
import { findAccount } from '../../workers/portal/src/signIns'

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const START = new Date('2026-11-02T12:00:00.000Z')
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('owner undo of a merge', () => {
  let db: Database.Database
  let deps: AppDeps
  let owner: number
  let me: number
  let other: number
  let printings: number[]
  let image: number

  beforeEach(async () => {
    db = await seededServerDb()
    printings = (
      db.prepare('SELECT id FROM card_printings ORDER BY id LIMIT 3').all() as { id: number }[]
    ).map((r) => r.id)
    image = (db.prepare('SELECT image_id FROM card_images LIMIT 1').get() as { image_id: number })
      .image_id
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
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test',
        ADMIN_DISCORD_ID: '999'
      },
      now: () => START,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
    owner = addUser(db, '999', 'owner')
    me = addUser(db, '111', 'kaiba')
    other = addUser(db, 'apple:sub1', 'appleuser')
    session(owner, 'tok-owner')
    session(me, 'tok-me')
  })

  function session(userId: number, token: string): void {
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
    ).run(sha256Hex(token), userId, START.toISOString(), new Date(START.getTime() + 30 * DAY).toISOString())
  }
  let seq = 0
  const addCard = (userId: number, printing: number, quantity: number): void => {
    db.prepare(
      `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, notes,
         created_at, updated_at, server_seq) VALUES (?, ?, ?, ?, ?, '', 'x', 'x', ?)`
    ).run(userId, `u-${++seq}`, printing, image, quantity, 1000 + seq)
  }
  const rowsOf = (id: number): unknown[] =>
    db.prepare('SELECT * FROM collection_entries WHERE user_id = ? ORDER BY id').all(id)
  const doMerge = (username: 'mine' | 'theirs' = 'mine'): void =>
    mergeAccounts(db, {
      survivor: me,
      closed: other,
      cards: 'sum',
      username,
      moved: { provider: 'apple', subject: 'sub1' },
      appleRefreshToken: 'rt-1',
      now: START
    })
  const cookie = (token: string): Record<string, string> => ({ cookie: `session=${token}` })
  const undo = (
    token: string | null,
    body: unknown = { closedId: other },
    headers: Record<string, string> = { 'content-type': 'application/json' }
  ): Promise<Response> =>
    handle(
      new Request(BASE + '/admin/merges/undo', {
        method: 'POST',
        headers: { origin: BASE, ...headers, ...(token ? cookie(token) : {}) },
        body: JSON.stringify(body)
      }),
      deps
    )
  const list = (token: string): Promise<Response> =>
    handle(new Request(BASE + '/admin/merges', { headers: cookie(token) }), deps)

  it('undo brings back the closed account with its sign-in and cards', async () => {
    addCard(me, printings[0], 3)
    addCard(other, printings[0], 5)
    addCard(other, printings[1], 4)
    const before = rowsOf(other)
    doMerge()
    expect(findAccount(db, { provider: 'apple', subject: 'sub1' })).toBe(me)
    const merged = rowsOf(me)

    const listed = (await (await list('tok-owner')).json()) as { merges: unknown[] }
    expect(listed.merges).toEqual([
      {
        closedId: other,
        survivorId: me,
        survivorUsername: 'kaiba',
        closedUsername: 'appleuser',
        mergedAt: START.toISOString(),
        purgeAfter: new Date(START.getTime() + 30 * DAY).toISOString(),
        cards: 'sum'
      }
    ])

    expect((await undo('tok-owner')).status).toBe(204)
    expect(findAccount(db, { provider: 'apple', subject: 'sub1' })).toBe(other)
    expect(findAccount(db, { provider: 'discord', subject: '111' })).toBe(me)
    expect(rowsOf(other)).toEqual(before)
    expect(rowsOf(me)).toEqual(merged)
    expect(
      db.prepare('SELECT closed_at, username, discord_id FROM users WHERE id = ?').get(other)
    ).toEqual({ closed_at: null, username: 'appleuser', discord_id: 'apple:sub1' })
    expect(
      db.prepare('SELECT 1 FROM apple_tokens WHERE user_id = ?').get(me)
    ).toBeUndefined()
    expect(
      db.prepare('SELECT refresh_token FROM apple_tokens WHERE user_id = ?').get(other)
    ).toEqual({ refresh_token: 'rt-1' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_merges').get()).toEqual({ n: 0 })
    expect(((await (await list('tok-owner')).json()) as { merges: unknown[] }).merges).toEqual([])
  })

  it('undo when the name was taken gives a generated one', async () => {
    doMerge('theirs')
    // The survivor now holds 'appleuser'.
    expect((await undo('tok-owner')).status).toBe(204)
    const row = db
      .prepare('SELECT username, username_chosen FROM users WHERE id = ?')
      .get(other) as { username: string; username_chosen: number }
    expect(row.username).toMatch(/^duelist-/)
    expect(row.username_chosen).toBe(0)
    expect(
      (db.prepare('SELECT username FROM users WHERE id = ?').get(me) as { username: string }).username
    ).toBe('appleuser')
  })

  it('leaves a sign-in the survivor removed since', async () => {
    doMerge()
    db.prepare("DELETE FROM sign_ins WHERE provider = 'apple'").run()
    expect((await undo('tok-owner')).status).toBe(204)
    expect(findAccount(db, { provider: 'apple', subject: 'sub1' })).toBeNull()
  })

  it('undo routes are owner-only', async () => {
    doMerge()
    expect((await list('tok-me')).status).toBe(404)
    expect((await undo('tok-me')).status).toBe(404)
    expect((await undo(null)).status).toBe(404)
    expect(
      (await undo('tok-owner', { closedId: other }, { 'content-type': 'text/plain' })).status
    ).toBe(415)
    expect((await undo('tok-owner', { closedId: 'x' })).status).toBe(400)
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_merges').get()).toEqual({ n: 1 })
  })

  it('a purged merge cannot be undone', async () => {
    doMerge()
    purgeHolds(db, new Date(START.getTime() + 31 * DAY))
    const res = await undo('tok-owner')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This merge is past its 30 days' })
    expect(((await (await list('tok-owner')).json()) as { merges: unknown[] }).merges).toEqual([])
  })

  it('an unknown merge is a 400', async () => {
    expect((await undo('tok-owner', { closedId: 4242 })).status).toBe(400)
  })
})
