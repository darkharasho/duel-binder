import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { addEntry, removeEntry } from '../../src/main/repo/collection'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, seededServerDb, memoryBucket, noPrintingArt, noPrices } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('friends RPC', () => {
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

  const NOT_FRIENDS = { error: "You aren't friends with this user" }
  const F = { sort: 'added', dir: 'desc' }
  let ca: string
  let cb: string

  const call = async (
    channel: string,
    args: unknown[],
    cookie: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ status: number; body: any }> => {
    const res = await rpc(channel, args, { cookie })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json()) as any }
  }

  async function befriend(): Promise<void> {
    await call('friends:request', ['bob'], ca)
    await call('friends:accept', [alice], cb)
  }

  async function bobOwns(): Promise<void> {
    const browse = (await (
      await rpc('cards:browse', [{ sort: 'name', dir: 'asc' }], { cookie: ca })
    ).json()) as { result: { cards: { defaultPrintingId: number; imageId: number }[] } }
    const [c1, c2] = browse.result.cards.filter((c) => c.defaultPrintingId != null)
    const scope = userScope(bob, 'ygo')
    const kept = addEntry(
      db,
      { printingId: c1.defaultPrintingId, imageId: c1.imageId, quantity: 1 },
      NOW,
      scope
    )
    db.prepare('UPDATE collection_entries SET notes = ? WHERE id = ?').run('secret', kept.id)
    const gone = addEntry(
      db,
      { printingId: c2.defaultPrintingId, imageId: c2.imageId, quantity: 1 },
      NOW,
      scope
    )
    removeEntry(db, gone.id, NOW, scope)
  }

  beforeEach(async () => {
    ca = await sessionFor(alice, 'ta')
    cb = await sessionFor(bob, 'tb')
  })

  it('sends a request that shows up in the target overview', async () => {
    const sent = await call('friends:request', ['bob'], ca)
    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ result: { status: 'sent' } })
    const o = await call('friends:overview', [], cb)
    expect(o.body.result.incoming[0].username).toBe('alice')
  })

  it('accepting makes both sides friends', async () => {
    await befriend()
    const o = await call('friends:overview', [], ca)
    expect(o.body.result.friends[0].username).toBe('bob')
  })

  it('serves a friend live entries with notes blanked', async () => {
    await befriend()
    await bobOwns()
    const r = await call('friends:collection', [bob, F], ca)
    expect(r.status).toBe(200)
    expect(r.body.result).toHaveLength(1)
    expect(r.body.result[0].notes).toBe('')
    expect((await call('friends:facets', [bob], ca)).status).toBe(200)
  })

  it("serves a friend's dashboard with notes blanked and no value history", async () => {
    await befriend()
    await bobOwns()
    const { status, body } = await call('friends:stats', [bob], ca)
    expect(status).toBe(200)
    const s = body.result
    expect(s.totalCards).toBe(1)
    expect(s.sharedCards).toBe(0)
    expect(s.valueHistory).toEqual([])
    for (const list of [s.topEntries, s.topSingles, s.recentEntries]) {
      expect(list).toHaveLength(1)
      expect(list[0].notes).toBe('')
    }
    expect(JSON.stringify(s)).not.toContain('secret')
  })

  it('counts cards you both have, in any printing, once each', async () => {
    await befriend()
    await bobOwns()
    const owned = (await call('friends:collection', [bob, F], ca)).body.result[0]
    const scope = userScope(alice, 'ygo')
    const mine = addEntry(
      db,
      { printingId: owned.printing.id, imageId: owned.imageId, quantity: 3 },
      NOW,
      scope
    )
    expect((await call('friends:stats', [bob], ca)).body.result.sharedCards).toBe(1)
    removeEntry(db, mine.id, NOW, scope)
    expect((await call('friends:stats', [bob], ca)).body.result.sharedCards).toBe(0)
  })

  it("serves a friend's set progress and checklist", async () => {
    await befriend()
    await bobOwns()
    const sets = (await call('friends:sets', [bob], ca)).body.result
    const started = sets.filter((s: { ownedCards: number }) => s.ownedCards > 0)
    expect(started).toHaveLength(1)
    const { setName, language } = started[0]
    const list = (await call('friends:checklist', [bob, setName, language], ca)).body.result
    expect(list.set.ownedCards).toBe(1)
    expect(list.cards.reduce((n: number, c: { owned: number }) => n + c.owned, 0)).toBe(1)
    expect(JSON.stringify(list)).not.toContain('secret')
  })

  it('answers which friends have a card, and nothing of strangers', async () => {
    await bobOwns()
    await befriend()
    const owned = (await call('friends:collection', [bob, F], ca)).body.result[0]
    const r = await call('friends:forCard', [owned.card.id], ca)
    expect(r.status).toBe(200)
    expect(r.body.result).toHaveLength(1)
    expect(r.body.result[0].username).toBe('bob')
    await call('friends:remove', [bob], ca)
    expect((await call('friends:forCard', [owned.card.id], ca)).body.result).toEqual([])
    expect((await call('friends:forCard', ['x'], ca)).status).toBe(400)
  })

  it('refuses strangers', async () => {
    const carol = addUser(db, '3', 'carol')
    const cc = await sessionFor(carol, 'tc')
    for (const [ch, args] of [
      ['friends:collection', [bob, F]],
      ['friends:facets', [bob]],
      ['friends:stats', [bob]],
      ['friends:sets', [bob]],
      ['friends:checklist', [bob, 'Any set', 'en']]
    ] as const) {
      const r = await call(ch, [...args], cc)
      expect(r.status).toBe(400)
      expect(r.body).toEqual(NOT_FRIENDS)
    }
  })

  it('refuses while a request is only pending', async () => {
    await call('friends:request', ['bob'], ca)
    for (const [ch, args] of [
      ['friends:collection', [bob, F]],
      ['friends:facets', [bob]]
    ] as const) {
      const r = await call(ch, [...args], ca)
      expect(r.status).toBe(400)
      expect(r.body).toEqual(NOT_FRIENDS)
    }
  })

  it('refuses after the friendship is removed', async () => {
    await befriend()
    expect((await call('friends:remove', [bob], ca)).status).toBe(200)
    for (const [ch, args] of [
      ['friends:collection', [bob, F]],
      ['friends:facets', [bob]]
    ] as const) {
      const r = await call(ch, [...args], ca)
      expect(r.status).toBe(400)
      expect(r.body).toEqual(NOT_FRIENDS)
    }
  })

  it('ignore clears an incoming request', async () => {
    await call('friends:request', ['bob'], ca)
    expect((await call('friends:ignore', [alice], cb)).status).toBe(200)
    expect((await call('friends:overview', [], cb)).body.result.incoming).toEqual([])
  })

  it('block cuts off the collection and unblock lifts it', async () => {
    await befriend()
    expect((await call('friends:block', [bob], ca)).status).toBe(200)
    expect((await call('friends:collection', [alice, F], cb)).body).toEqual(NOT_FRIENDS)
    expect((await call('friends:overview', [], ca)).body.result.blocked[0].username).toBe('bob')
    expect((await call('friends:request', ['alice'], cb)).body).toEqual({
      result: { status: 'sent' }
    })
    expect((await call('friends:overview', [], ca)).body.result.incoming).toEqual([])
    expect((await call('friends:unblock', [bob], ca)).status).toBe(200)
    expect((await call('friends:overview', [], ca)).body.result.blocked).toEqual([])
  })

  it('rejects an unknown username', async () => {
    const r = await call('friends:request', ['zed'], ca)
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'No Duel Binder user called "zed"' })
  })

  it('rejects a bad user id', async () => {
    expect((await call('friends:collection', ['x', {}], ca)).status).toBe(400)
  })

  it('rejects signed-out callers with 401', async () => {
    expect((await rpc('friends:overview', [])).status).toBe(401)
  })

  it('works with a desktop bearer token', async () => {
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
    ).run(
      await sha256Hex('dtok'),
      alice,
      NOW.toISOString(),
      new Date(NOW.getTime() + 30 * 86400_000).toISOString()
    )
    const res = await handle(
      new Request(`${BASE}/api/rpc/friends:overview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer dtok' },
        body: JSON.stringify({ args: [] })
      }),
      deps
    )
    expect(res.status).toBe(200)
  })
})
