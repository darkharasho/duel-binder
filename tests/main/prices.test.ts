import type Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PriceUnavailableError, createPriceClient, type PriceClient } from '../../src/main/prices/client'
import { PRICE_INTERVAL_MS, refreshIntlPrices } from '../../src/main/prices/refresh'
import { priceWorkerUrl } from '../../src/main/prices/config'
import { getMeta } from '../../src/main/db/meta'
import { addEntry } from '../../src/main/repo/collection'
import { seededDb } from './helpers'

const q = { code: 'LB-05', name: 'Blue-Eyes White Dragon', set: 'LOB', rarity: 'Ultra Rare', lang: 'ja' as const }
const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('client sends X-Client and the query params', async () => {
  const fetchFn = vi.fn(async () => ok({ price: 12.5, listingCount: 3, currency: 'USD', checkedAt: 'T' }))
  const c = createPriceClient({ url: 'https://w.example/', fetchFn: fetchFn as unknown as typeof fetch })
  await expect(c.lookup(q)).resolves.toEqual({ price: 12.5, listingCount: 3, checkedAt: 'T' })
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
  const u = new URL(url)
  expect(u.origin + u.pathname).toBe('https://w.example/v1/price')
  expect(Object.fromEntries(u.searchParams)).toEqual({
    code: 'LB-05',
    name: 'Blue-Eyes White Dragon',
    set: 'LOB',
    rarity: 'Ultra Rare',
    lang: 'ja'
  })
  expect(new Headers(init.headers).get('X-Client')).toBe('ygo-collection-tracker')
})

test('client maps 502, bad JSON and bad shape to PriceUnavailableError', async () => {
  const mk = (fetchFn: unknown): PriceClient => createPriceClient({ url: 'https://w', fetchFn: fetchFn as typeof fetch })
  await expect(mk(async () => ok({}, 502)).lookup(q)).rejects.toBeInstanceOf(PriceUnavailableError)
  await expect(mk(async () => new Response('nope', { status: 200 })).lookup(q)).rejects.toBeInstanceOf(
    PriceUnavailableError
  )
  await expect(mk(async () => ok({ price: 'x' })).lookup(q)).rejects.toBeInstanceOf(PriceUnavailableError)
  await expect(
    mk(async () => {
      throw new TypeError('network')
    }).lookup(q)
  ).rejects.toBeInstanceOf(PriceUnavailableError)
})

test('client times out after 15 s', async () => {
  vi.useFakeTimers()
  try {
    const fetchFn = (_u: string, init: RequestInit): Promise<Response> =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const p = createPriceClient({ url: 'https://w', fetchFn: fetchFn as unknown as typeof fetch }).lookup(q)
    const assertion = expect(p).rejects.toBeInstanceOf(PriceUnavailableError)
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  } finally {
    vi.useRealTimers()
  }
})

test('priceWorkerUrl is null when empty and honours the env override', () => {
  const prev = process.env['YGO_PRICE_WORKER_URL']
  try {
    delete process.env['YGO_PRICE_WORKER_URL']
    expect(priceWorkerUrl()).toBeNull()
    process.env['YGO_PRICE_WORKER_URL'] = 'https://x.example'
    expect(priceWorkerUrl()).toBe('https://x.example')
  } finally {
    if (prev === undefined) delete process.env['YGO_PRICE_WORKER_URL']
    else process.env['YGO_PRICE_WORKER_URL'] = prev
  }
})

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
})
afterEach(() => db.close())

const NOW = new Date('2026-10-23T12:00:00.000Z')
const ago = (days: number): string => new Date(NOW.getTime() - days * 24 * 3600 * 1000).toISOString()

function owned(code: string, lang: string, qty = 1): number {
  const id = (
    db
      .prepare(
        `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
         VALUES (46986414, ?, 'LOB', ?, 'Ultra Rare') RETURNING id`
      )
      .get(lang, code) as { id: number }
  ).id
  addEntry(db, { printingId: id, imageId: 46986414, quantity: qty })
  return id
}
const row = (
  id: number
): { price: number | null; listing_count: number; checked_at: string } | undefined =>
  db.prepare('SELECT * FROM intl_prices WHERE printing_id = ?').get(id) as
    | { price: number | null; listing_count: number; checked_at: string }
    | undefined
const fakeClient = (
  impl?: (q: { code: string }) => Promise<unknown>
): { client: PriceClient; lookup: ReturnType<typeof vi.fn> } => {
  const lookup = vi.fn(
    impl ??
      (async () => ({ price: 9, listingCount: 2, checkedAt: ago(0) }))
  )
  return { client: { lookup } as unknown as PriceClient, lookup }
}

test('only owned non-English printings are looked up, and rows are written', async () => {
  const ja = owned('LB-05', 'ja')
  // unowned ja printing and an owned English one
  db.prepare(
    `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity) VALUES (46986414, 'ko', 'LOB', 'LB-KR', 'Rare')`
  ).run()
  const { client, lookup } = fakeClient()
  addEntry(db, {
    printingId: (db.prepare("SELECT id FROM card_printings WHERE set_code = 'LOB-EN005'").get() as { id: number }).id,
    imageId: 46986414,
    quantity: 1
  })
  const r = await refreshIntlPrices(db, client, { now: NOW })
  expect(r).toEqual({ updated: 1, failed: 0 })
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(lookup.mock.calls[0][0]).toMatchObject({ code: 'LB-05', lang: 'ja', set: 'LOB', rarity: 'Ultra Rare' })
  expect(row(ja)).toMatchObject({ price: 9, listing_count: 2 })
  expect(getMeta(db, 'price_service_status')).toBe('ok')
})

test('a 3-day-old row is skipped, an 8-day-old one refreshed', async () => {
  const fresh = owned('LB-05', 'ja')
  const stale = owned('LB-06', 'ko')
  const ins = db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 1, 1, ?)')
  ins.run(fresh, ago(3))
  ins.run(stale, ago(8))
  const { client, lookup } = fakeClient()
  expect(PRICE_INTERVAL_MS).toBe(7 * 24 * 3600 * 1000)
  await refreshIntlPrices(db, client, { now: NOW })
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(lookup.mock.calls[0][0]).toMatchObject({ code: 'LB-06' })
  expect(row(fresh)?.price).toBe(1)
  expect(row(stale)?.price).toBe(9)
})

test('printingIds limits the run', async () => {
  owned('LB-05', 'ja')
  const b = owned('LB-06', 'ko')
  const { client, lookup } = fakeClient()
  await refreshIntlPrices(db, client, { now: NOW, printingIds: [b] })
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(lookup.mock.calls[0][0]).toMatchObject({ code: 'LB-06' })
})

test('a null client sets the status to unavailable and calls nothing', async () => {
  owned('LB-05', 'ja')
  await expect(refreshIntlPrices(db, null, { now: NOW })).resolves.toEqual({ updated: 0, failed: 0 })
  expect(getMeta(db, 'price_service_status')).toBe('unavailable')
})

test('one failure among two lookups still updates the other', async () => {
  const a = owned('LB-05', 'ja')
  const b = owned('LB-06', 'ko')
  const { client } = fakeClient(async (query) => {
    if (query.code === 'LB-05') throw new PriceUnavailableError('down')
    return { price: null, listingCount: 0, checkedAt: ago(0) }
  })
  await expect(refreshIntlPrices(db, client, { now: NOW })).resolves.toEqual({ updated: 1, failed: 1 })
  expect(row(a)).toBeUndefined()
  expect(row(b)).toMatchObject({ price: null, listing_count: 0 })
  expect(getMeta(db, 'price_service_status')).toBe('ok')
})

test('every lookup failing sets the status to unavailable', async () => {
  owned('LB-05', 'ja')
  const { client } = fakeClient(async () => {
    throw new PriceUnavailableError('down')
  })
  await expect(refreshIntlPrices(db, client, { now: NOW })).resolves.toEqual({ updated: 0, failed: 1 })
  expect(getMeta(db, 'price_service_status')).toBe('unavailable')
})
