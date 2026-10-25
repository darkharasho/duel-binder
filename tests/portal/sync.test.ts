import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { setMeta } from '../../src/main/db/meta'
import { pullSince } from '../../workers/portal/src/sync'
import type {
  PricesResponse,
  PullResponse,
  PushResponse,
  PushResult,
  WireEntry
} from '../../src/shared/cloud'
import { addUser, seededServerDb, memoryBucket, noPrintingArt } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const T0 = '2026-10-24T10:00:00.000Z'
const T1 = '2026-10-24T11:00:00.000Z'
const T2 = '2026-10-24T11:30:00.000Z'
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

interface Printing {
  id: number
  pkey: string
  imageId: number
  setName: string
  language: string
}

interface Row {
  uid: string
  user_id: number
  quantity: number
  notes: string
  updated_at: string
  deleted_at: string | null
  server_seq: number
}

describe('sync routes', () => {
  let db: Database.Database
  let deps: AppDeps
  let soon: ReturnType<typeof vi.fn<() => Promise<void>>>
  let alice: number
  let bob: number
  let a: Printing
  let b: Printing
  const ALICE = 'Bearer alice-desktop-token'
  const BOB = 'Bearer bob-desktop-token'

  const session = (userId: number, token: string, kind: 'web' | 'desktop'): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sha256Hex(token),
      userId,
      kind,
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
  }

  const entry = (overrides: Partial<WireEntry> = {}): WireEntry => ({
    uid: crypto.randomUUID(),
    pkey: a.pkey,
    imageId: a.imageId,
    quantity: 1,
    notes: '',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides
  })

  const send = (
    path: string,
    init: RequestInit = {},
    auth: string | null = ALICE
  ): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(auth ? { authorization: auth } : {}),
          ...(init.headers as Record<string, string> | undefined)
        }
      }),
      deps
    )
  const pushRaw = (body: unknown, auth: string | null = ALICE): Promise<Response> =>
    send('/api/sync/push', { method: 'POST', body: JSON.stringify(body) }, auth)
  const push = async (entries: WireEntry[], auth = ALICE): Promise<PushResult[]> => {
    const res = await pushRaw({ entries }, auth)
    expect(res.status).toBe(200)
    return ((await res.json()) as PushResponse).results
  }
  const pull = async (cursor: number, auth = ALICE): Promise<PullResponse> => {
    const res = await send(`/api/sync/pull?cursor=${cursor}`, {}, auth)
    expect(res.status).toBe(200)
    return (await res.json()) as PullResponse
  }
  const rows = (userId: number): Row[] =>
    db
      .prepare(
        `SELECT uid, user_id, quantity, notes, updated_at, deleted_at, server_seq FROM collection_entries
         WHERE user_id = ? ORDER BY server_seq`
      )
      .all(userId) as Row[]
  const row = (uid: string): Row =>
    db
      .prepare(
        'SELECT uid, user_id, quantity, notes, updated_at, deleted_at, server_seq FROM collection_entries WHERE uid = ?'
      )
      .get(uid) as Row

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
    session(alice, 'alice-desktop-token', 'desktop')
    session(bob, 'bob-desktop-token', 'desktop')
    const printings = db
      .prepare(
        `SELECT p.id, p.pkey, p.set_name AS setName, p.language,
           (SELECT image_id FROM card_images i WHERE i.card_id = p.card_id ORDER BY sort_order LIMIT 1) AS imageId
         FROM card_printings p ORDER BY p.card_id, p.id`
      )
      .all() as Printing[]
    a = printings[0]
    b = printings.find((p) => p.imageId !== a.imageId)!
    soon = vi.fn<() => Promise<void>>(async () => {})
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: { soon },
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

  it('push inserts and pull returns entries with a cursor', async () => {
    const e1 = entry({ quantity: 3, notes: 'binder 2' })
    const e2 = entry({ pkey: b.pkey, imageId: b.imageId })
    expect(await push([e1, e2])).toEqual([
      { uid: e1.uid, status: 'applied' },
      { uid: e2.uid, status: 'applied' }
    ])
    const page = await pull(0)
    expect(page.more).toBe(false)
    expect(page.entries).toEqual([expect.objectContaining(e1), expect.objectContaining(e2)])
    expect(page.entries.map((e) => Object.keys(e).length)).toEqual([9, 9])
    expect(page.cursor).toBe(page.entries[1].seq)
    expect(page.entries[0].seq).toBeLessThan(page.entries[1].seq)
    expect(await pull(page.cursor)).toEqual({ entries: [], cursor: page.cursor, more: false })
  })

  it('pushing the same payload twice changes nothing', async () => {
    const e = entry({ quantity: 2 })
    await push([e])
    const before = row(e.uid)
    expect(await push([e])).toEqual([{ uid: e.uid, status: 'applied' }])
    expect(row(e.uid)).toEqual(before)
  })

  it('newer edit wins; an older edit is stale and gets the server row back', async () => {
    const e = entry()
    await push([e])
    const newer = { ...e, quantity: 4, updatedAt: T2 }
    expect(await push([newer])).toEqual([{ uid: e.uid, status: 'applied' }])
    expect(row(e.uid)).toMatchObject({ quantity: 4, updated_at: T2 })
    const older = { ...e, quantity: 9, updatedAt: T1 }
    expect(await push([older])).toEqual([{ uid: e.uid, status: 'stale', current: newer }])
    expect(row(e.uid).quantity).toBe(4)
  })

  it('a tombstone beats an older live edit and the entry never comes back', async () => {
    const e = entry()
    await push([e])
    const tomb = { ...e, updatedAt: T1, deletedAt: T1 }
    expect(await push([tomb])).toEqual([{ uid: e.uid, status: 'applied' }])
    expect(row(e.uid).deleted_at).toBe(T1)
    // A live edit at the same time, or earlier, loses to the tombstone.
    for (const at of [T0, T1]) {
      const live = { ...e, quantity: 7, updatedAt: at }
      expect(await push([live])).toEqual([{ uid: e.uid, status: 'stale', current: tomb }])
    }
    expect(row(e.uid)).toMatchObject({ deleted_at: T1, quantity: 1 })
  })

  describe('two uids on one printing+art converge to the newer', () => {
    const lowUid = '00000000-0000-4000-8000-000000000001'
    const highUid = 'ffffffff-ffff-4fff-bfff-ffffffffffff'

    const check = async (
      first: WireEntry,
      second: WireEntry,
      kept: WireEntry,
      lost: WireEntry
    ): Promise<void> => {
      await push([first])
      const results = await push([second])
      if (kept === second) expect(results).toEqual([{ uid: second.uid, status: 'applied' }])
      else expect(results).toEqual([{ uid: second.uid, status: 'merged', winner: kept }])
      const live = rows(alice).filter((r) => r.deleted_at === null)
      expect(live.map((r) => r.uid)).toEqual([kept.uid])
      expect(row(lost.uid).deleted_at).not.toBeNull()
      expect(row(lost.uid).server_seq).toBeLessThan(row(kept.uid).server_seq)
    }

    it('the newer incoming entry wins', async () => {
      const older = entry({ uid: lowUid, updatedAt: T0 })
      const newer = entry({ uid: highUid, quantity: 2, updatedAt: T1 })
      await check(older, newer, newer, older)
    })

    it('an older incoming entry merges into the newer one', async () => {
      const newer = entry({ uid: lowUid, quantity: 2, updatedAt: T1 })
      const older = entry({ uid: highUid, updatedAt: T0 })
      await check(newer, older, newer, older)
      // The merged uid is now a tombstone carrying the client's fields.
      expect(row(highUid)).toMatchObject({ deleted_at: T0, quantity: 1 })
    })

    it('an equal-time tie keeps the smaller uid when it comes second', async () => {
      const high = entry({ uid: highUid })
      const low = entry({ uid: lowUid, quantity: 2 })
      await check(high, low, low, high)
    })

    it('an equal-time tie keeps the smaller uid when it comes first', async () => {
      const low = entry({ uid: lowUid, quantity: 2 })
      const high = entry({ uid: highUid })
      await check(low, high, low, high)
    })
  })

  it('a tombstone for an unknown uid stores nothing', async () => {
    const tomb = entry({ deletedAt: T1, updatedAt: T1 })
    expect(await push([tomb])).toEqual([{ uid: tomb.uid, status: 'applied' }])
    expect(rows(alice)).toEqual([])
    expect(soon).not.toHaveBeenCalled()
  })

  it("an unknown pkey or another card's image answers unknown-printing", async () => {
    const unknown = entry({ pkey: 'en|999|NEW-001|Rare' })
    const wrongArt = entry({ imageId: b.imageId })
    const noArt = entry({ imageId: 999_999_999 })
    expect(await push([unknown, wrongArt, noArt])).toEqual([
      { uid: unknown.uid, status: 'unknown-printing' },
      { uid: wrongArt.uid, status: 'unknown-printing' },
      { uid: noArt.uid, status: 'unknown-printing' }
    ])
    expect(rows(alice)).toEqual([])
  })

  it('a uid owned by another user is rejected and untouched', async () => {
    const bobs = entry({ quantity: 5 })
    await push([bobs], BOB)
    const before = row(bobs.uid)
    for (const attempt of [
      { ...bobs, quantity: 1, updatedAt: T2 },
      { ...bobs, deletedAt: T2, updatedAt: T2 },
      bobs
    ]) {
      expect(await push([attempt])).toEqual([{ uid: bobs.uid, status: 'rejected' }])
    }
    expect(row(bobs.uid)).toEqual(before)
    expect(rows(alice)).toEqual([])
    expect((await pull(0)).entries).toEqual([])
  })

  it("pull returns only the caller's rows, tombstones included, in seq order, paged", async () => {
    const e1 = entry()
    const e2 = entry({ pkey: b.pkey, imageId: b.imageId })
    await push([e1, e2])
    await push([entry({ quantity: 8 })], BOB)
    await push([{ ...e1, deletedAt: T1, updatedAt: T1 }])
    const all = await pull(0)
    expect(all.entries.map((e) => [e.uid, e.deletedAt])).toEqual([
      [e2.uid, null],
      [e1.uid, T1]
    ])
    expect(all.entries[0].seq).toBeLessThan(all.entries[1].seq)

    const first = pullSince(db, alice, 0, 1)
    expect(first.entries.map((e) => e.uid)).toEqual([e2.uid])
    expect(first.more).toBe(true)
    expect(first.cursor).toBe(first.entries[0].seq)
    const second = pullSince(db, alice, first.cursor, 1)
    expect(second.entries.map((e) => e.uid)).toEqual([e1.uid])
    expect(second.more).toBe(false)
    expect(pullSince(db, alice, second.cursor, 1)).toEqual({
      entries: [],
      cursor: second.cursor,
      more: false
    })
  })

  it('far-future times are clamped to server time', async () => {
    const ahead = new Date(NOW.getTime() + 365 * 86_400_000).toISOString()
    const e = entry({ createdAt: ahead, updatedAt: ahead })
    await push([e])
    const stored = db
      .prepare('SELECT created_at, updated_at FROM collection_entries WHERE uid = ?')
      .get(e.uid) as { created_at: string; updated_at: string }
    expect(stored).toEqual({ created_at: NOW.toISOString(), updated_at: NOW.toISOString() })
    // Within the allowed skew, a time is kept (normalised to toISOString form).
    const near = entry({ pkey: b.pkey, imageId: b.imageId, updatedAt: '2026-10-24T12:05:00Z' })
    await push([near])
    expect(row(near.uid).updated_at).toBe('2026-10-24T12:05:00.000Z')
  })

  it('bad payloads answer 400', async () => {
    const bad: unknown[] = [
      { entries: 'nope' },
      {},
      null,
      { entries: [5] },
      { entries: [{ ...entry(), uid: 5 }] },
      { entries: [{ ...entry(), uid: 'not-a-uuid' }] },
      { entries: [{ ...entry(), quantity: 0 }] },
      { entries: [{ ...entry(), quantity: 1.5 }] },
      { entries: [{ ...entry(), quantity: '2' }] },
      { entries: [{ ...entry(), pkey: 1 }] },
      { entries: [{ ...entry(), pkey: '' }] },
      { entries: [{ ...entry(), pkey: 'x'.repeat(301) }] },
      { entries: [{ ...entry(), imageId: 0 }] },
      { entries: [{ ...entry(), updatedAt: 'yesterday' }] },
      { entries: [{ ...entry(), createdAt: 5 }] },
      { entries: [{ ...entry(), deletedAt: 'never' }] },
      { entries: [{ ...entry(), notes: 'x'.repeat(2001) }] },
      { entries: [{ ...entry(), notes: 5 }] }
    ]
    for (const body of bad) {
      const res = await pushRaw(body)
      expect(res.status, JSON.stringify(body)?.slice(0, 120)).toBe(400)
      expect(typeof ((await res.json()) as { error: unknown }).error).toBe('string')
    }
    const notJson = await send('/api/sync/push', { method: 'POST', body: '{' })
    expect(notJson.status).toBe(400)
    expect(rows(alice)).toEqual([])

    for (const q of ['cursor=-1', 'cursor=x', 'cursor=1.5', '']) {
      const res = await send(`/api/sync/pull?${q}`)
      expect(res.status, q).toBe(400)
    }

    for (const body of [{ pkeys: [1] }, { pkeys: 'x' }, {}]) {
      const res = await send('/api/sync/prices', { method: 'POST', body: JSON.stringify(body) })
      expect(res.status).toBe(400)
    }

    const tooMany = await pushRaw({ entries: Array.from({ length: 501 }, () => entry()) })
    expect(tooMany.status).toBe(413)
    expect(await tooMany.json()).toEqual({ error: 'too-many' })
    const tooManyKeys = await send('/api/sync/prices', {
      method: 'POST',
      body: JSON.stringify({ pkeys: Array.from({ length: 1001 }, (_, i) => `k${i}`) })
    })
    expect(tooManyKeys.status).toBe(413)
  })

  it('sync routes need a desktop token', async () => {
    session(alice, 'alice-web-token', 'web')
    const calls = [
      (auth: string | null, extra?: Record<string, string>) =>
        send(
          '/api/sync/push',
          { method: 'POST', body: JSON.stringify({ entries: [entry()] }), headers: extra },
          auth
        ),
      (auth: string | null, extra?: Record<string, string>) =>
        send('/api/sync/pull?cursor=0', { headers: extra }, auth),
      (auth: string | null, extra?: Record<string, string>) =>
        send(
          '/api/sync/prices',
          { method: 'POST', body: JSON.stringify({ pkeys: [a.pkey] }), headers: extra },
          auth
        )
    ]
    for (const call of calls) {
      expect((await call(null)).status).toBe(401)
      expect((await call('Bearer alice-web-token')).status).toBe(401)
      expect((await call(null, { cookie: 'session=alice-web-token' })).status).toBe(401)
      expect((await call('Bearer nobody')).status).toBe(401)
    }
    expect(rows(alice)).toEqual([])
  })

  it('web writes reach a desktop pull', async () => {
    session(alice, 'alice-web-token', 'web')
    const rpc = async (channel: string, args: unknown[]): Promise<unknown> => {
      const res = await send(
        `/api/rpc/${channel}`,
        {
          method: 'POST',
          body: JSON.stringify({ args }),
          headers: { cookie: 'session=alice-web-token' }
        },
        null
      )
      expect(res.status, channel).toBe(200)
      return ((await res.json()) as { result: unknown }).result
    }
    let cursor = 0
    const pulledUids = async (): Promise<string[]> => {
      const page = await pull(cursor)
      cursor = page.cursor
      return page.entries.map((e) => e.uid)
    }
    const added = (await rpc('collection:add', [
      { printingId: a.id, imageId: a.imageId, quantity: 1 }
    ])) as {
      id: number
    }
    const uid = (
      db.prepare('SELECT uid FROM collection_entries WHERE id = ?').get(added.id) as { uid: string }
    ).uid
    expect(await pulledUids()).toEqual([uid])
    await rpc('collection:update', [added.id, { quantity: 3 }])
    expect(await pulledUids()).toEqual([uid])
    await rpc('sets:adjust', [a.setName, a.language, a.id, 1])
    expect(await pulledUids()).toEqual([uid])
    await rpc('collection:remove', [added.id])
    const last = await pull(cursor)
    expect(last.entries.map((e) => [e.uid, e.deletedAt])).toEqual([[uid, NOW.toISOString()]])
  })

  it("push records the caller's value snapshot and queues prices", async () => {
    await push([entry({ quantity: 3 })])
    expect(db.prepare('SELECT user_id, total_cards FROM value_snapshots').all()).toEqual([
      { user_id: alice, total_cards: 3 }
    ])
    expect(soon).toHaveBeenCalledTimes(1)
    soon.mockClear()
    // A push that applies no live entry queues nothing.
    await push([entry({ deletedAt: T1, updatedAt: T1 })])
    expect(soon).not.toHaveBeenCalled()
  })

  it('prices returns server rows by pkey and the service status', async () => {
    db.prepare(
      'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)'
    ).run(a.id, 12.5, 4, T1)
    db.prepare(
      'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)'
    ).run(b.id, null, 0, T0)
    setMeta(db, 'price_service_status', 'ok')
    const res = await send('/api/sync/prices', {
      method: 'POST',
      body: JSON.stringify({ pkeys: [a.pkey, 'en|999|NEW-001|Rare', b.pkey] })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as PricesResponse
    expect(body.status).toBe('ok')
    expect([...body.prices].sort((x, y) => x.pkey.localeCompare(y.pkey))).toEqual(
      [
        { pkey: a.pkey, price: 12.5, listingCount: 4, checkedAt: T1 },
        { pkey: b.pkey, price: null, listingCount: 0, checkedAt: T0 }
      ].sort((x, y) => x.pkey.localeCompare(y.pkey))
    )
  })
})
