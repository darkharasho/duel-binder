import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import {
  PRICE_FAILED_MS,
  PRICE_IDLE_MS,
  PRICE_MORE_MS,
  PRICE_SOON_MS,
  alarmQueue,
  priceClientFor,
  runPriceAlarm,
  type AlarmStorage
} from '../../workers/portal/src/prices'
import type { SweepClient } from '../../workers/portal/src/sweep'
import { SWEEP_BATCH } from '../../workers/portal/src/sweep'
import { PriceUnavailableError, type PriceClient, type PriceQuery } from '../../src/main/prices/client'
import { addEntry, removeEntry } from '../../src/main/repo/collection'
import { getMeta } from '../../src/main/db/meta'
import { refreshIntlPrices } from '../../src/main/prices/refresh'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, memoryBucket, noPrintingArt, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const T = NOW.getTime()
const ago = (days: number): string => new Date(T - days * 24 * 3600 * 1000).toISOString()

function fakeStorage(alarm: number | null = null): AlarmStorage & { alarm: number | null } {
  const s = {
    alarm,
    getAlarm: async () => s.alarm,
    setAlarm: async (t: number) => {
      s.alarm = t
    }
  }
  return s
}

function fakeClient(impl?: (q: PriceQuery) => Promise<unknown>): { client: PriceClient; lookup: ReturnType<typeof vi.fn> } {
  const lookup = vi.fn(impl ?? (async () => ({ price: 7.5, listingCount: 4, checkedAt: NOW.toISOString() })))
  return { client: { lookup } as unknown as PriceClient, lookup }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('server eBay prices', () => {
  let db: Database.Database
  let alice: number
  let bob: number
  /** Two printings with an image each, P1.id < P2.id. */
  let p1: { id: number; imageId: number; code: string }
  let p2: { id: number; imageId: number; code: string }

  const own = (userId: number, p: { id: number; imageId: number }): number =>
    addEntry(db, { printingId: p.id, imageId: p.imageId, quantity: 1 }, NOW, userScope(userId)).id
  const price = (id: number): { price: number | null; checked_at: string } | undefined =>
    db.prepare('SELECT price, checked_at FROM intl_prices WHERE printing_id = ?').get(id) as
      | { price: number | null; checked_at: string }
      | undefined
  const setPrice = (id: number, checkedAt: string): void => {
    db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 1, 1, ?)').run(
      id,
      checkedAt
    )
  }

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
    const ps = db
      .prepare(
        `SELECT p.id, p.set_code AS code,
           (SELECT image_id FROM card_images i WHERE i.card_id = p.card_id LIMIT 1) AS imageId
         FROM card_printings p WHERE imageId IS NOT NULL ORDER BY p.id LIMIT 2`
      )
      .all() as { id: number; imageId: number; code: string }[]
    ;[p1, p2] = ps
  })

  it('the alarm prices printings owned by any user, never-priced first, in batches', async () => {
    own(alice, p1)
    own(bob, p2)
    setPrice(p1.id, ago(8)) // stale, but P2 has never been priced so it goes first
    const storage = fakeStorage()
    const { client, lookup } = fakeClient()

    await runPriceAlarm(db, client, storage, () => NOW, null, { limit: 1 })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup.mock.calls[0][0]).toMatchObject({ code: p2.code })
    expect(price(p2.id)?.price).toBe(7.5)
    expect(storage.alarm).toBe(T + PRICE_MORE_MS)

    // The second run is that alarm firing a minute later.
    const later = new Date(T + PRICE_MORE_MS)
    await runPriceAlarm(db, client, storage, () => later, null, { limit: 1 })
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(lookup.mock.calls[1][0]).toMatchObject({ code: p1.code })
    expect(price(p1.id)?.price).toBe(7.5)
    expect(storage.alarm).toBe(later.getTime() + PRICE_IDLE_MS)
    expect(getMeta(db, 'price_service_status')).toBe('ok')
  })

  it('alarm re-arms in 60 s while the sweep has work', async () => {
    for (let i = 0; i < SWEEP_BATCH + 1; i++)
      db.prepare(`INSERT INTO price_sweeps (key, language) VALUES (?, 'ja')`).run(`K${i}-JP`)
    db.prepare(`INSERT INTO meta (key, value) VALUES ('price_sweeps_listed_at', '2026-10-24')`).run()
    const sweep: SweepClient = {
      set: vi.fn(async () => ({ codes: {}, calls: 1, checkedAt: NOW.toISOString() })),
      quota: vi.fn(async () => ({ remaining: 5000 }))
    }
    const storage = fakeStorage()
    await runPriceAlarm(db, fakeClient().client, storage, () => NOW, sweep)
    expect(sweep.set).toHaveBeenCalledTimes(SWEEP_BATCH)
    expect(storage.alarm).toBe(T + PRICE_MORE_MS)
    // The next run clears the last prefix: nothing more, back to idle.
    const later = new Date(T + PRICE_MORE_MS)
    await runPriceAlarm(db, fakeClient().client, storage, () => later, sweep)
    expect(storage.alarm).toBe(later.getTime() + PRICE_IDLE_MS)
  })

  it('printings owned by nobody, or only by tombstones, are skipped', async () => {
    const id = own(alice, p1)
    removeEntry(db, id, NOW, userScope(alice))
    const storage = fakeStorage()
    const { client, lookup } = fakeClient()
    await runPriceAlarm(db, client, storage, () => NOW)
    expect(lookup).not.toHaveBeenCalled()
    expect(price(p1.id)).toBeUndefined()
    expect(price(p2.id)).toBeUndefined()
    expect(storage.alarm).toBe(T + PRICE_IDLE_MS)
  })

  it('prices older than 7 days are refreshed and fresher ones are left alone', async () => {
    own(alice, p1)
    own(bob, p2)
    setPrice(p1.id, ago(3))
    setPrice(p2.id, ago(8))
    const { client, lookup } = fakeClient()
    await runPriceAlarm(db, client, fakeStorage(), () => NOW)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup.mock.calls[0][0]).toMatchObject({ code: p2.code })
    expect(price(p1.id)).toEqual({ price: 1, checked_at: ago(3) })
    expect(price(p2.id)?.price).toBe(7.5)
  })

  it('a per-card "nothing found" keeps the price and does not bump price_seq', async () => {
    own(alice, p1)
    db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 4, 5, ?)').run(p1.id, ago(8))
    type Row = { price: number | null; listing_count: number; checked_at: string; price_seq: number }
    const seq = (): Row =>
      db.prepare('SELECT price, listing_count, checked_at, price_seq FROM intl_prices WHERE printing_id = ?').get(p1.id) as Row
    const before = seq().price_seq
    const { client } = fakeClient(async () => ({ price: null, listingCount: 0, checkedAt: NOW.toISOString() }))
    await refreshIntlPrices(db, client, { now: NOW })
    expect(seq()).toEqual({ price: 4, listing_count: 5, checked_at: NOW.toISOString(), price_seq: before })
  })

  it('a failing price Worker re-arms in an hour and never throws', async () => {
    own(alice, p1)
    own(bob, p2)
    const storage = fakeStorage()
    const { client } = fakeClient(async () => {
      throw new PriceUnavailableError('down')
    })
    await expect(runPriceAlarm(db, client, storage, () => NOW, null, { limit: 1 })).resolves.toBeUndefined()
    expect(storage.alarm).toBe(T + PRICE_FAILED_MS)
    expect(getMeta(db, 'price_service_status')).toBe('unavailable')
  })

  it('a lookup queued during the run keeps its earlier alarm', async () => {
    own(alice, p1)
    const storage = fakeStorage(T) // the alarm that is firing
    const queue = alarmQueue(storage, () => T)
    const { client } = fakeClient(async () => {
      await queue.soon() // a web write landing while the lookup is in flight
      return { price: 7.5, listingCount: 4, checkedAt: NOW.toISOString() }
    })
    await runPriceAlarm(db, client, storage, () => NOW)
    expect(storage.alarm).toBe(T + PRICE_SOON_MS)
  })

  it('the firing alarm still left in storage does not stop the re-arm', async () => {
    const storage = fakeStorage(T)
    await runPriceAlarm(db, fakeClient().client, storage, () => NOW)
    expect(storage.alarm).toBe(T + PRICE_IDLE_MS)
  })

  it('a run whose re-arm fails still resolves', async () => {
    own(alice, p1)
    const storage: AlarmStorage = {
      getAlarm: async () => null,
      setAlarm: async () => {
        throw new Error('storage down')
      }
    }
    await expect(runPriceAlarm(db, fakeClient().client, storage, () => NOW)).resolves.toBeUndefined()
    expect(price(p1.id)?.price).toBe(7.5)
  })

  it('soon() never rejects', async () => {
    const storage: AlarmStorage = {
      getAlarm: async () => null,
      setAlarm: async () => {
        throw new Error('storage down')
      }
    }
    await expect(alarmQueue(storage, () => T).soon()).resolves.toBeUndefined()
  })

  it('soon() never pushes an earlier alarm later', async () => {
    const early = fakeStorage(T + 1_000)
    await alarmQueue(early, () => T).soon()
    expect(early.alarm).toBe(T + 1_000)

    const late = fakeStorage(T + PRICE_IDLE_MS)
    await alarmQueue(late, () => T).soon()
    expect(late.alarm).toBe(T + PRICE_SOON_MS)

    const none = fakeStorage()
    await alarmQueue(none, () => T).soon()
    expect(none.alarm).toBe(T + PRICE_SOON_MS)
  })

  it('a paced soon() keeps an alarm due within a minute, so requests keep the batch pacing', async () => {
    const batching = fakeStorage(T + PRICE_MORE_MS)
    await alarmQueue(batching, () => T).soon({ paced: true })
    expect(batching.alarm).toBe(T + PRICE_MORE_MS)
    // An unpaced one (a collection write) still brings it forward.
    await alarmQueue(batching, () => T).soon()
    expect(batching.alarm).toBe(T + PRICE_SOON_MS)

    const idle = fakeStorage(T + PRICE_IDLE_MS)
    await alarmQueue(idle, () => T).soon({ paced: true })
    expect(idle.alarm).toBe(T + PRICE_SOON_MS)

    const none = fakeStorage()
    await alarmQueue(none, () => T).soon({ paced: true })
    expect(none.alarm).toBe(T + PRICE_SOON_MS)
  })

  describe('through the web', () => {
    let deps: AppDeps
    let soon: ReturnType<typeof vi.fn<() => Promise<void>>>
    let cookie: string

    const rpc = (channel: string, args: unknown): Promise<Response> =>
      handle(
        new Request(`${BASE}/api/rpc/${channel}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ args })
        }),
        deps
      )

    beforeEach(async () => {
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        await sha256Hex('ta'),
        alice,
        NOW.toISOString(),
        new Date(T + 3600_000).toISOString()
      )
      cookie = 'session=ta'
      soon = vi.fn(async () => {})
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

    it("a web add queues a lookup; reads don't", async () => {
      expect((await rpc('collection:list', [{}])).status).toBe(200)
      expect(soon).not.toHaveBeenCalled()
      expect((await rpc('collection:add', [{ printingId: p1.id, imageId: p1.imageId, quantity: 1 }])).status).toBe(200)
      expect(soon).toHaveBeenCalledTimes(1)
    })

    it('web updates and set adjustments queue a lookup too', async () => {
      const add = (await (
        await rpc('collection:add', [{ printingId: p1.id, imageId: p1.imageId, quantity: 1 }])
      ).json()) as { result: { id: number } }
      soon.mockClear()
      expect((await rpc('collection:update', [add.result.id, { quantity: 3 }])).status).toBe(200)
      expect(soon).toHaveBeenCalledTimes(1)
      const { set_name, language } = db
        .prepare('SELECT set_name, language FROM card_printings WHERE id = ?')
        .get(p2.id) as { set_name: string; language: string }
      expect((await rpc('sets:adjust', [set_name, language, p2.id, 1])).status).toBe(200)
      expect(soon).toHaveBeenCalledTimes(2)
    })

    it('a write still succeeds when the alarm cannot be armed', async () => {
      deps.prices = alarmQueue(
        {
          getAlarm: async () => null,
          setAlarm: async () => {
            throw new Error('storage down')
          }
        },
        () => T
      )
      const res = await rpc('collection:add', [{ printingId: p1.id, imageId: p1.imageId, quantity: 1 }])
      expect(res.status).toBe(200)
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM collection_entries WHERE user_id = ? AND deleted_at IS NULL').get(alice)
      ).toEqual({ n: 1 })
    })

    it('the web shows the server price', async () => {
      expect((await rpc('collection:add', [{ printingId: p1.id, imageId: p1.imageId, quantity: 2 }])).status).toBe(200)
      await runPriceAlarm(db, fakeClient().client, fakeStorage(), () => NOW)
      const { result } = (await (await rpc('collection:list', [{}])).json()) as {
        result: { unitPrice: number | null; priceSource: string }[]
      }
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ unitPrice: 7.5, priceSource: 'ebay' })
    })
  })
})

describe('priceClientFor', () => {
  const query: PriceQuery = {
    code: 'LOB-001',
    name: 'Blue-Eyes White Dragon',
    set: 'Legend of Blue Eyes White Dragon',
    rarity: 'Ultra Rare',
    lang: 'en'
  }
  const ok = (): Response =>
    new Response(JSON.stringify({ price: 7.5, listingCount: 4, checkedAt: NOW.toISOString() }), { status: 200 })

  it('is null when PRICE_WORKER_URL is empty, even with a binding', () => {
    expect(priceClientFor({ PRICE_WORKER_URL: '', PRICES: { fetch: vi.fn() } })).toBeNull()
  })

  it('sends lookups through the PRICES service binding when present', async () => {
    const binding = { fetch: vi.fn(async () => ok()) }
    const global = vi.spyOn(globalThis, 'fetch')
    try {
      const client = priceClientFor({ PRICE_WORKER_URL: 'https://prices.example', PRICES: binding })
      await expect(client!.lookup(query)).resolves.toMatchObject({ price: 7.5 })
      expect(binding.fetch).toHaveBeenCalledTimes(1)
      expect(String((binding.fetch.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/prices\.example\/v1\/price\?/)
      expect(global).not.toHaveBeenCalled()
    } finally {
      global.mockRestore()
    }
  })

  it('falls back to global fetch without a binding', async () => {
    const global = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok())
    try {
      const client = priceClientFor({ PRICE_WORKER_URL: 'https://prices.example' })
      await expect(client!.lookup(query)).resolves.toMatchObject({ price: 7.5 })
      expect(global).toHaveBeenCalledTimes(1)
    } finally {
      global.mockRestore()
    }
  })
})
