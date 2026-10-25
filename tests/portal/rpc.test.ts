import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { addEntry } from '../../src/main/repo/collection'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, seededServerDb, memoryBucket, noPrintingArt, noPrices } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('read-only RPC', () => {
  let db: Database.Database
  let deps: AppDeps
  let alice: number
  let bob: number

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
    opts: { cookie?: string; type?: string | null; raw?: string; method?: string } = {}
  ): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (opts.type !== null) headers['content-type'] = opts.type ?? 'application/json'
    if (opts.cookie) headers.cookie = opts.cookie
    const method = opts.method ?? 'POST'
    return handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : (opts.raw ?? JSON.stringify({ args }))
      }),
      deps
    )
  }

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
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

  it('searches cards for a signed-in user', async () => {
    const cookie = await sessionFor(alice, 'ta')
    const res = await rpc('cards:search', ['dark magician'], { cookie })
    expect(res.status).toBe(200)
    const { result } = (await res.json()) as { result: { name: string }[] }
    expect(result.map((c) => c.name)).toContain('Dark Magician')
  })

  it('lists only the caller own collection entries', async () => {
    const dm = (await (
      await rpc('cards:search', ['dark magician'], { cookie: await sessionFor(alice, 'ta') })
    ).json()) as {
      result: { printingId?: number; defaultPrintingId?: number; imageId: number }[]
    }
    const browse = (await (
      await rpc('cards:browse', [{ q: 'dark magician', sort: 'name', dir: 'asc' }], {
        cookie: await sessionFor(bob, 'tb')
      })
    ).json()) as { result: { cards: { defaultPrintingId: number; imageId: number }[] } }
    expect(dm.result.length).toBeGreaterThan(0)
    const card = browse.result.cards[0]
    addEntry(
      db,
      { printingId: card.defaultPrintingId, imageId: card.imageId, quantity: 3 },
      NOW,
      userScope(alice)
    )

    const a = (await (await rpc('collection:list', [{}], { cookie: 'session=ta' })).json()) as {
      result: unknown[]
    }
    const b = (await (await rpc('collection:list', [{}], { cookie: 'session=tb' })).json()) as {
      result: unknown[]
    }
    expect(a.result).toHaveLength(1)
    expect(b.result).toHaveLength(0)
  })

  it('rejects signed-out callers with 401', async () => {
    expect((await rpc('cards:search', ['x'])).status).toBe(401)
  })

  it('rejects non-JSON content types with 415 before anything else', async () => {
    expect((await rpc('cards:search', ['x'], { type: 'text/plain' })).status).toBe(415)
    expect((await rpc('cards:search', ['x'], { type: null, raw: '{}' })).status).toBe(415)
  })

  it('accepts a charset parameter on the content type', async () => {
    const cookie = await sessionFor(alice, 'ta')
    expect(
      (await rpc('cards:search', ['x'], { cookie, type: 'application/json; charset=utf-8' })).status
    ).toBe(200)
  })

  it('returns 404 for channels the portal does not serve', async () => {
    const cookie = await sessionFor(alice, 'ta')
    const res = await rpc('sync:run', [], { cookie })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown-channel' })
    expect((await rpc('nope:nope', [], { cookie })).status).toBe(404)
  })

  it('returns 400 for an unknown language on sets:checklist', async () => {
    const cookie = await sessionFor(alice, 'ta')
    expect((await rpc('sets:checklist', ['Some Set', 'xx'], { cookie })).status).toBe(400)
  })

  it('returns 400 for bad bodies', async () => {
    const cookie = await sessionFor(alice, 'ta')
    expect((await rpc('cards:search', null, { cookie, raw: 'not json' })).status).toBe(400)
    expect((await rpc('cards:search', null, { cookie, raw: '{}' })).status).toBe(400)
    expect((await rpc('cards:search', null, { cookie, raw: '{"args":"x"}' })).status).toBe(400)
  })

  it('rejects other methods with 405', async () => {
    expect((await rpc('cards:search', null, { method: 'GET' })).status).toBe(405)
  })
})
