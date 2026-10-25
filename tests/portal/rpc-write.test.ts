import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { addUser, seededServerDb, memoryBucket, noPrintingArt, noPrices } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface Row {
  id: number
  user_id: number
  quantity: number
  deleted_at: string | null
  updated_at: string
}

describe('write RPC', () => {
  let db: Database.Database
  let deps: AppDeps
  let alice: number
  let bob: number
  let printingId: number
  let imageId: number
  let setName: string
  let language: string

  async function sessionFor(userId: number, token: string): Promise<string> {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(
      await sha256Hex(token),
      userId,
      NOW.toISOString(),
      new Date(NOW.getTime() + 3600_000).toISOString()
    )
    return `session=${token}`
  }

  const rpc = (
    channel: string,
    args: unknown,
    cookie?: string,
    path = `/api/rpc/${channel}`
  ): Promise<Response> =>
    handle(
      new Request(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ args })
      }),
      deps
    )

  const rows = (userId?: number): Row[] =>
    db
      .prepare(
        `SELECT id, user_id, quantity, deleted_at, updated_at FROM collection_entries
         ${userId === undefined ? '' : 'WHERE user_id = ' + userId} ORDER BY id`
      )
      .all() as Row[]

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
    const p = db
      .prepare(
        `SELECT p.id, p.set_name, p.language, (SELECT image_id FROM card_images i WHERE i.card_id = p.card_id LIMIT 1) AS image_id
         FROM card_printings p WHERE image_id IS NOT NULL LIMIT 1`
      )
      .get() as { id: number; set_name: string; language: string; image_id: number }
    printingId = p.id
    imageId = p.image_id
    setName = p.set_name
    language = p.language
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
      fetch: (() => {
        throw new Error('no network')
      }) as unknown as typeof fetch
    }
  })

  const bobsEntry = async (): Promise<Row> => {
    const cookie = await sessionFor(bob, 'tb')
    const res = await rpc('collection:add', [{ printingId, imageId, quantity: 5 }], cookie)
    expect(res.status).toBe(200)
    return rows(bob)[0]
  }

  it("add creates an entry and records today's snapshot", async () => {
    const cookie = await sessionFor(alice, 'ta')
    const res = await rpc('collection:add', [{ printingId, imageId, quantity: 2 }], cookie)
    expect(res.status).toBe(200)
    const { result } = (await res.json()) as { result: { quantity: number } }
    expect(result.quantity).toBe(2)
    const snaps = db.prepare('SELECT user_id, total_cards FROM value_snapshots').all()
    expect(snaps).toEqual([{ user_id: alice, total_cards: 2 }])
  })

  it('rejects notes longer than 2000 characters with a 400', async () => {
    const cookie = await sessionFor(alice, 'ta')
    const add = await rpc('collection:add', [{ printingId, imageId, quantity: 1, notes: 'x'.repeat(2001) }], cookie)
    expect(add.status).toBe(400)
    expect(await add.json()).toEqual({ error: 'notes must be at most 2000 characters' })
    await rpc('collection:add', [{ printingId, imageId, quantity: 1 }], cookie)
    const id = rows(alice)[0].id
    expect((await rpc('collection:update', [id, { notes: 'x'.repeat(2001) }], cookie)).status).toBe(400)
    expect((await rpc('collection:update', [id, { notes: 'x'.repeat(2000) }], cookie)).status).toBe(200)
  })

  it('adding the same printing twice sums into one entry', async () => {
    const cookie = await sessionFor(alice, 'ta')
    for (let i = 0; i < 2; i++)
      expect((await rpc('collection:add', [{ printingId, imageId, quantity: 1 }], cookie)).status).toBe(200)
    const live = rows(alice).filter((r) => r.deleted_at === null)
    expect(live).toHaveLength(1)
    expect(live[0].quantity).toBe(2)
  })

  it('update and remove change only the caller entries', async () => {
    const theirs = await bobsEntry()
    const cookie = await sessionFor(alice, 'ta')
    expect((await rpc('collection:update', [theirs.id, { quantity: 9 }], cookie)).status).toBe(400)
    const res = await rpc('collection:remove', [theirs.id], cookie)
    expect([200, 400]).toContain(res.status)
    expect(rows(bob)).toEqual([theirs])
    expect(rows(bob)[0].deleted_at).toBeNull()
  })

  it('remove tombstones and a second remove leaves deleted_at as it was', async () => {
    const cookie = await sessionFor(alice, 'ta')
    await rpc('collection:add', [{ printingId, imageId, quantity: 1 }], cookie)
    const id = rows(alice)[0].id
    expect((await rpc('collection:remove', [id], cookie)).status).toBe(200)
    const first = rows(alice)[0]
    expect(first.deleted_at).toBe(NOW.toISOString())
    deps = { ...deps, now: () => new Date(NOW.getTime() + 60_000) }
    expect((await rpc('collection:remove', [id], cookie)).status).toBe(200)
    expect(rows(alice)[0]).toEqual(first)
  })

  it('sets:adjust adds and removes one copy for the caller only', async () => {
    await bobsEntry()
    const cookie = await sessionFor(alice, 'ta')
    const args = (delta: number): unknown[] => [setName, language, printingId, delta]
    expect((await rpc('sets:adjust', args(1), cookie)).status).toBe(200)
    expect((await rpc('sets:adjust', args(1), cookie)).status).toBe(200)
    expect(rows(alice)[0].quantity).toBe(2)
    expect((await rpc('sets:adjust', args(-1), cookie)).status).toBe(200)
    expect(rows(alice)[0].quantity).toBe(1)
    expect(rows(bob)[0].quantity).toBe(5)
  })

  it('stats:get counts only the caller live entries', async () => {
    await bobsEntry()
    const cookie = await sessionFor(alice, 'ta')
    await rpc('collection:add', [{ printingId, imageId, quantity: 3 }], cookie)
    const stats = (await (await rpc('stats:get', [], cookie)).json()) as {
      result: { totalCards: number; uniqueCards: number }
    }
    expect(stats.result.totalCards).toBe(3)
    expect(stats.result.uniqueCards).toBe(1)
    await rpc('collection:remove', [rows(alice)[0].id], cookie)
    const after = (await (await rpc('stats:get', [], cookie)).json()) as {
      result: { totalCards: number }
    }
    expect(after.result.totalCards).toBe(0)
  })

  it('bad argument types answer 400', async () => {
    const cookie = await sessionFor(alice, 'ta')
    const cases: [string, unknown[]][] = [
      ['collection:add', ['x']],
      ['collection:add', [{ printingId: '1', imageId: 1, quantity: 1 }]],
      ['collection:update', [1, 'nope']],
      ['collection:remove', ['1']],
      ['sets:adjust', ['S', 'en', 1, 2]],
      ['cards:get', ['1']]
    ]
    for (const [channel, args] of cases) {
      const res = await rpc(channel, args, cookie)
      expect(res.status, channel).toBe(400)
      expect(typeof ((await res.json()) as { error: unknown }).error).toBe('string')
    }
  })

  it('a malformed channel escape answers 400', async () => {
    const cookie = await sessionFor(alice, 'ta')
    const res = await rpc('', [], cookie, '/api/rpc/%E0%A4%A')
    expect(res.status).toBe(400)
  })
})
