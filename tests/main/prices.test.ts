import type Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PriceUnavailableError, createPriceClient, type PriceClient } from '../../src/main/prices/client'
import { PRICE_INTERVAL_MS, needsPrice, refreshIntlPrices } from '../../src/main/prices/refresh'
import { PRICE_WORKER_URL, priceWorkerUrl } from '../../src/main/prices/config'
import { REQUEST_WINDOW_MS, countCandidates, priceCandidates } from '../../src/main/prices/candidates'
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
  expect(new Headers(init.headers).get('X-Client')).toBe('duel-binder')
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

test('priceWorkerUrl defaults to the deployed Worker and honours the env override', () => {
  const prev = process.env['YGO_PRICE_WORKER_URL']
  try {
    delete process.env['YGO_PRICE_WORKER_URL']
    expect(priceWorkerUrl()).toBe(PRICE_WORKER_URL)
    process.env['YGO_PRICE_WORKER_URL'] = ''
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

test('only owned printings are looked up, and rows are written', async () => {
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
  // The owned ja printing and the owned English one; the unowned ko printing is skipped.
  expect(r).toEqual({ updated: 2, failed: 0, remaining: 0 })
  expect(lookup).toHaveBeenCalledTimes(2)
  expect(lookup.mock.calls.map((c) => c[0].lang).sort()).toEqual(['en', 'ja'])
  expect(lookup.mock.calls.find((c) => c[0].lang === 'ja')?.[0]).toMatchObject({
    code: 'LB-05',
    set: 'LOB',
    rarity: 'Ultra Rare'
  })
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
  await expect(refreshIntlPrices(db, null, { now: NOW })).resolves.toEqual({ updated: 0, failed: 0, remaining: 0 })
  expect(getMeta(db, 'price_service_status')).toBe('unavailable')
})

test('one failure among two lookups still updates the other', async () => {
  const a = owned('LB-05', 'ja')
  const b = owned('LB-06', 'ko')
  const { client } = fakeClient(async (query) => {
    if (query.code === 'LB-05') throw new PriceUnavailableError('down')
    return { price: null, listingCount: 0, checkedAt: ago(0) }
  })
  await expect(refreshIntlPrices(db, client, { now: NOW })).resolves.toEqual({ updated: 1, failed: 1, remaining: 0 })
  expect(row(a)).toBeUndefined()
  expect(row(b)).toMatchObject({ price: null, listing_count: 0 })
  expect(getMeta(db, 'price_service_status')).toBe('ok')
})

test('a lookup that finds nothing keeps an existing price and stamps checked_at', async () => {
  const a = owned('LB-05', 'ja')
  db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 4, 5, ?)').run(a, ago(8))
  const { client } = fakeClient(async () => ({ price: null, listingCount: 0, checkedAt: ago(0) }))
  await expect(refreshIntlPrices(db, client, { now: NOW })).resolves.toEqual({ updated: 1, failed: 0, remaining: 0 })
  expect(row(a)).toMatchObject({ price: 4, listing_count: 5, checked_at: ago(0) })
  expect(needsPrice(db, a, NOW)).toBe(false)
  // A real price still replaces it.
  db.prepare('UPDATE intl_prices SET checked_at = ? WHERE printing_id = ?').run(ago(8), a)
  await refreshIntlPrices(db, fakeClient().client, { now: NOW })
  expect(row(a)).toMatchObject({ price: 9, listing_count: 2 })
})

test('every lookup failing sets the status to unavailable', async () => {
  owned('LB-05', 'ja')
  const { client } = fakeClient(async () => {
    throw new PriceUnavailableError('down')
  })
  await expect(refreshIntlPrices(db, client, { now: NOW })).resolves.toEqual({ updated: 0, failed: 1, remaining: 0 })
  expect(getMeta(db, 'price_service_status')).toBe('unavailable')
})

test('an owned English printing with no row is a candidate and gets upserted', async () => {
  const en = owned('LOB-EN900', 'en')
  const { client, lookup } = fakeClient()
  expect(needsPrice(db, en, NOW)).toBe(true)
  await expect(refreshIntlPrices(db, client, { now: NOW })).resolves.toEqual({ updated: 1, failed: 0, remaining: 0 })
  expect(lookup.mock.calls[0][0]).toMatchObject({ code: 'LOB-EN900', lang: 'en' })
  expect(row(en)).toMatchObject({ price: 9, listing_count: 2 })
})

test('an English printing checked within 7 days is skipped', async () => {
  const en = owned('LOB-EN900', 'en')
  db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 1, 1, ?)').run(en, ago(3))
  const { client, lookup } = fakeClient()
  expect(needsPrice(db, en, NOW)).toBe(false)
  await refreshIntlPrices(db, client, { now: NOW })
  expect(lookup).not.toHaveBeenCalled()
})

test('needsPrice is true for a stale English printing', () => {
  const en = owned('LOB-EN900', 'en')
  db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 1, 1, ?)').run(en, ago(8))
  expect(needsPrice(db, en, NOW)).toBe(true)
})

test('an English printing with a TCGplayer market price never asks eBay', async () => {
  const en = owned('LOB-EN900', 'en')
  db.prepare('UPDATE card_printings SET market_price = 3 WHERE id = ?').run(en)
  const { client, lookup } = fakeClient()
  expect(needsPrice(db, en, NOW)).toBe(false)
  await refreshIntlPrices(db, client, { now: NOW })
  expect(lookup).not.toHaveBeenCalled()
})

function unowned(code: string, lang: string): number {
  return (
    db
      .prepare(
        `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
         VALUES (46986414, ?, 'LOB', ?, 'Ultra Rare') RETURNING id`
      )
      .get(lang, code) as { id: number }
  ).id
}
const request = (id: number, at: string): void => {
  db.prepare('INSERT INTO price_requests (printing_id, requested_at) VALUES (?, ?)').run(id, at)
}

test('a printing requested in the last 7 days is a candidate; an older request is not', () => {
  const recent = unowned('LB-JP01', 'ja')
  const old = unowned('LB-JP02', 'ja')
  unowned('LB-JP03', 'ja') // never requested
  request(recent, ago(6))
  request(old, ago(8))
  expect(REQUEST_WINDOW_MS).toBe(PRICE_INTERVAL_MS)
  expect(priceCandidates(db, NOW).map((c) => c.id)).toEqual([recent])
  expect(countCandidates(db, NOW)).toBe(1)
})

test('a Manga-Style printing is priced as its tone, other variants as their rarity', () => {
  const ids = ['Manga-Style, Color', 'Overframe', 'New artwork'].map((variant, i) => {
    const id = unowned(`X-JP0${i}`, 'ja')
    db.prepare('UPDATE card_printings SET variant = ? WHERE id = ?').run(variant, id)
    request(id, ago(0))
    return id
  })
  const mono = unowned('', 'ja')
  db.prepare("UPDATE card_printings SET set_rarity = 'Ultra Rare (Manga-Style, Monochrome)' WHERE id = ?").run(mono)
  request(mono, ago(0))
  const rarity = new Map(priceCandidates(db, NOW).map((c) => [c.id, c.rarity]))
  expect([...ids, mono].map((id) => rarity.get(id))).toEqual([
    'Ultra Rare (Manga-Style, Color)',
    'Ultra Rare',
    'Ultra Rare',
    'Ultra Rare (Manga-Style, Monochrome)'
  ])
})

test('a requested printing priced since the request is not a candidate again', () => {
  const id = unowned('LB-JP01', 'ja')
  request(id, ago(1))
  db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 2, 3, ?)').run(
    id,
    ago(0.5)
  )
  expect(priceCandidates(db, NOW)).toEqual([])
})

test('owned printings come before requested ones, even stale owned before never-priced requested', () => {
  const requested = unowned('LB-JP01', 'ja')
  request(requested, ago(0))
  const staleOwned = owned('LB-JP02', 'ja')
  db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 1, 1, ?)').run(
    staleOwned,
    ago(9)
  )
  const newOwned = owned('LB-JP03', 'ja')
  expect(priceCandidates(db, NOW).map((c) => c.id)).toEqual([newOwned, staleOwned, requested])
  // A batch of 2 holds only the owned ones; the requested one waits for the next batch.
  expect(priceCandidates(db, NOW, { limit: 2 }).map((c) => c.id)).toEqual([newOwned, staleOwned])
  expect(countCandidates(db, NOW)).toBe(3)
})

test('the refresh prices a requested printing nobody owns', async () => {
  const id = unowned('LB-JP01', 'ja')
  request(id, ago(0))
  const { client, lookup } = fakeClient()
  await expect(refreshIntlPrices(db, client, { now: NOW })).resolves.toEqual({ updated: 1, failed: 0, remaining: 0 })
  expect(lookup.mock.calls[0][0]).toMatchObject({ code: 'LB-JP01', lang: 'ja' })
  expect(row(id)?.price).toBe(9)
})

test('candidates look printings up from what is owned or asked for, never scanning per printing', async () => {
  // The catalog has ~340k printings: a full scan of it, or of the collection once per printing,
  // froze the desktop's main process for tens of seconds on every sync.
  const db = await seededDb()
  const seen: string[] = []
  const prepare = db.prepare.bind(db)
  db.prepare = ((sql: string) => {
    seen.push(sql)
    return prepare(sql)
  }) as typeof db.prepare
  priceCandidates(db, NOW, { limit: 10 })
  countCandidates(db, NOW)
  db.prepare = prepare
  expect(seen).toHaveLength(2)
  for (const sql of seen) {
    const params = (sql.match(/\?/g) ?? []).map(() => '')
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map(
      (r) => r.detail
    )
    expect(plan.filter((d) => /^SCAN (p|e)\b/.test(d)), plan.join('\n')).toEqual([])
  }
})
