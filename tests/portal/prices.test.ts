import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import {
  PRICE_FAILED_MS,
  PRICE_IDLE_MS,
  PRICE_MORE_MS,
  PRICE_SOON_MS,
  alarmQueue,
  runPriceAlarm,
  type AlarmStorage
} from '../../workers/portal/src/prices'
import { PriceUnavailableError, type PriceClient, type PriceQuery } from '../../src/main/prices/client'
import { addEntry, removeEntry } from '../../src/main/repo/collection'
import { getMeta } from '../../src/main/db/meta'
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

    await runPriceAlarm(db, client, storage, () => NOW, { limit: 1 })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup.mock.calls[0][0]).toMatchObject({ code: p2.code })
    expect(price(p2.id)?.price).toBe(7.5)
    expect(storage.alarm).toBe(T + PRICE_MORE_MS)

    await runPriceAlarm(db, client, storage, () => NOW, { limit: 1 })
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(lookup.mock.calls[1][0]).toMatchObject({ code: p1.code })
    expect(price(p1.id)?.price).toBe(7.5)
    expect(storage.alarm).toBe(T + PRICE_IDLE_MS)
    expect(getMeta(db, 'price_service_status')).toBe('ok')
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

  it('a failing price Worker re-arms in an hour and never throws', async () => {
    own(alice, p1)
    own(bob, p2)
    const storage = fakeStorage()
    const { client } = fakeClient(async () => {
      throw new PriceUnavailableError('down')
    })
    await expect(runPriceAlarm(db, client, storage, () => NOW, { limit: 1 })).resolves.toBeUndefined()
    expect(storage.alarm).toBe(T + PRICE_FAILED_MS)
    expect(getMeta(db, 'price_service_status')).toBe('unavailable')
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
