import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import {
  DAILY_REQUESTS,
  USER_DAILY_REQUESTS,
  requestPrices
} from '../../workers/portal/src/priceRequests'
import { PRICE_MORE_MS, runPriceAlarm, type AlarmStorage } from '../../workers/portal/src/prices'
import type { PriceClient } from '../../src/main/prices/client'
import { setMeta } from '../../src/main/db/meta'
import { addEntry } from '../../src/main/repo/collection'
import { MAX_PRICE_REQUEST, type PriceRequestResponse } from '../../src/shared/cloud'
import { userScope } from '../../workers/portal/src/scope'
import { addUser, memoryBucket, noPrintingArt, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const T = NOW.getTime()
const ago = (days: number): string => new Date(T - days * 24 * 3600 * 1000).toISOString()
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

interface P {
  id: number
  pkey: string
  code: string
}

describe('price requests', () => {
  let db: Database.Database
  let deps: AppDeps
  let soon: ReturnType<typeof vi.fn<(opts?: { paced?: boolean }) => Promise<void>>>
  let alice: number
  let bob: number
  let cardId: number
  let imageId: number
  const ALICE = 'Bearer alice-desktop-token'
  const BOB = 'Bearer bob-desktop-token'

  const session = (userId: number, token: string, kind: 'web' | 'desktop'): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(sha256Hex(token), userId, kind, NOW.toISOString(), new Date(T + 86_400_000).toISOString())
  }
  let n = 0
  /** A new printing of the test card; Japanese unless `lang` says otherwise. */
  const printing = (lang = 'ja'): P =>
    db
      .prepare(
        `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
         VALUES (?, ?, 'Test Set', ?, 'Ultra Rare') RETURNING id, pkey, set_code AS code`
      )
      .get(cardId, lang, `TST-JP${String(++n).padStart(3, '0')}`) as P
  const price = (p: P, checkedAt: string): void => {
    db.prepare(
      'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 3, 2, ?)'
    ).run(p.id, checkedAt)
  }
  const requested = (): number[] =>
    (
      db.prepare('SELECT printing_id FROM price_requests ORDER BY printing_id').all() as {
        printing_id: number
      }[]
    ).map((r) => r.printing_id)
  const logged = (userId: number): number | undefined =>
    (
      db
        .prepare('SELECT count FROM price_request_log WHERE user_id = ? AND day = ?')
        .get(userId, '2026-10-24') as { count: number } | undefined
    )?.count
  const send = (body: unknown, auth: string | null = ALICE): Promise<Response> =>
    handle(
      new Request(`${BASE}/api/sync/price-requests`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }
      }),
      deps
    )
  const ask = async (pkeys: string[], auth = ALICE): Promise<PriceRequestResponse> => {
    const res = await send({ pkeys }, auth)
    expect(res.status).toBe(200)
    return (await res.json()) as PriceRequestResponse
  }

  beforeEach(async () => {
    db = await seededServerDb()
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
    session(alice, 'alice-desktop-token', 'desktop')
    session(bob, 'bob-desktop-token', 'desktop')
    ;({ cardId, imageId } = db
      .prepare('SELECT card_id AS cardId, image_id AS imageId FROM card_images LIMIT 1')
      .get() as { cardId: number; imageId: number })
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

  it('queues unpriced or stale non-English printings and paces the alarm', async () => {
    const fresh = printing()
    const stale = printing()
    const none = printing()
    const en = printing('en')
    price(fresh, ago(2))
    price(stale, ago(8))
    const r = await ask([fresh.pkey, stale.pkey, none.pkey, en.pkey, 'ja|0|NOPE-JP001|Rare'])
    expect(r).toEqual({ queued: 2, capped: false })
    expect(requested()).toEqual([stale.id, none.id].sort((x, y) => x - y))
    expect(logged(alice)).toBe(2)
    expect(soon).toHaveBeenCalledWith({ paced: true })
  })

  it('skips owned printings: the alarm prices them anyway', async () => {
    const p = printing()
    addEntry(db, { printingId: p.id, imageId, quantity: 1 }, NOW, userScope(bob, 'ygo'))
    expect(await ask([p.pkey])).toEqual({ queued: 0, capped: false })
    expect(requested()).toEqual([])
    expect(soon).not.toHaveBeenCalled()
  })

  it('a printing already requested this week is not queued or counted again, by anyone', async () => {
    const p = printing()
    expect((await ask([p.pkey, p.pkey])).queued).toBe(1)
    expect(await ask([p.pkey])).toEqual({ queued: 0, capped: false })
    expect(await ask([p.pkey], BOB)).toEqual({ queued: 0, capped: false })
    expect(logged(alice)).toBe(1)
    expect(logged(bob)).toBeUndefined()
    expect(soon).toHaveBeenCalledTimes(1)
  })

  it('a request older than the window is replaced by a new one', async () => {
    const p = printing()
    db.prepare('INSERT INTO price_requests (printing_id, requested_at) VALUES (?, ?)').run(
      p.id,
      ago(8)
    )
    expect((await ask([p.pkey])).queued).toBe(1)
    expect(
      db.prepare('SELECT requested_at FROM price_requests WHERE printing_id = ?').get(p.id)
    ).toEqual({ requested_at: NOW.toISOString() })
  })

  it("a user's daily limit takes the first printings sent and counts only what it queued", () => {
    const ps = [printing(), printing(), printing()]
    db.prepare('INSERT INTO price_request_log (user_id, day, count) VALUES (?, ?, ?)').run(
      alice,
      '2026-10-24',
      USER_DAILY_REQUESTS - 2
    )
    expect(
      requestPrices(
        db,
        alice,
        ps.map((p) => p.pkey),
        NOW
      )
    ).toEqual({ queued: 2, capped: true })
    expect(requested()).toEqual([ps[0].id, ps[1].id])
    expect(logged(alice)).toBe(USER_DAILY_REQUESTS)
    // At the limit: nothing more today, but another user still can.
    expect(requestPrices(db, alice, [ps[2].pkey], NOW)).toEqual({ queued: 0, capped: true })
    expect(requestPrices(db, bob, [ps[2].pkey], NOW)).toEqual({ queued: 1, capped: false })
  })

  it("yesterday's count doesn't hold back today", () => {
    const p = printing()
    db.prepare('INSERT INTO price_request_log (user_id, day, count) VALUES (?, ?, ?)').run(
      alice,
      '2026-10-23',
      USER_DAILY_REQUESTS
    )
    expect(requestPrices(db, alice, [p.pkey], NOW).queued).toBe(1)
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM price_request_log WHERE day = '2026-10-23'").get()
    ).toEqual({ n: 0 })
  })

  it('the daily limit across all users caps everyone', () => {
    const ps = [printing(), printing()]
    db.prepare('INSERT INTO price_request_log (user_id, day, count) VALUES (?, ?, ?)').run(
      bob,
      '2026-10-24',
      DAILY_REQUESTS - 1
    )
    expect(
      requestPrices(
        db,
        alice,
        ps.map((p) => p.pkey),
        NOW
      )
    ).toEqual({ queued: 1, capped: true })
    expect(USER_DAILY_REQUESTS).toBeLessThan(DAILY_REQUESTS)
  })

  it('while the eBay Worker is failing, requests wait for the backoff alarm', async () => {
    setMeta(db, 'price_service_status', 'unavailable')
    expect((await ask([printing().pkey])).queued).toBe(1)
    expect(soon).not.toHaveBeenCalled()
  })

  it('bad bodies answer 400, too many keys 413, and only desktop tokens may ask', async () => {
    expect((await send({ pkeys: 'x' })).status).toBe(400)
    expect((await send({ pkeys: [1] })).status).toBe(400)
    expect((await send({ pkeys: ['x'.repeat(301)] })).status).toBe(400)
    const many = Array.from({ length: MAX_PRICE_REQUEST + 1 }, (_, i) => `ja|${i}`)
    expect((await send({ pkeys: many })).status).toBe(413)
    expect((await send({ pkeys: [] }, null)).status).toBe(401)
    session(alice, 'alice-web-cookie', 'web')
    expect((await send({ pkeys: [] }, 'Bearer alice-web-cookie')).status).toBe(401)
    expect(requested()).toEqual([])
  })

  it('the alarm prices a requested printing after the owned ones', async () => {
    const wanted = printing()
    const mine = printing()
    addEntry(db, { printingId: mine.id, imageId, quantity: 1 }, NOW, userScope(alice, 'ygo'))
    await ask([wanted.pkey])
    const lookup = vi.fn(async () => ({ price: 4, listingCount: 3, checkedAt: NOW.toISOString() }))
    const client = { lookup } as unknown as PriceClient
    const storage: AlarmStorage & { alarm: number | null } = {
      alarm: null,
      getAlarm: async () => storage.alarm,
      setAlarm: async (t) => {
        storage.alarm = t
      }
    }
    await runPriceAlarm(db, client, storage, () => NOW, null, { limit: 1 })
    expect(lookup.mock.calls[0]).toEqual([expect.objectContaining({ code: mine.code })])
    expect(storage.alarm).toBe(T + PRICE_MORE_MS)
    await runPriceAlarm(db, client, storage, () => NOW, null, { limit: 1 })
    expect(lookup.mock.calls[1]).toEqual([expect.objectContaining({ code: wanted.code })])
    expect(
      db.prepare('SELECT price FROM intl_prices WHERE printing_id = ?').get(wanted.id)
    ).toEqual({ price: 4 })
  })
})
