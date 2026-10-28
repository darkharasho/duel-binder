import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudClient } from '../../src/main/cloud/client'
import { stalePricePkeys } from '../../src/main/cloud/localSync'
import {
  AWAIT_PRICES_MS,
  REQUEST_AGAIN_MS,
  awaitingPrices,
  checkPrintingIds,
  printingsToRequest,
  requestPrices
} from '../../src/main/cloud/priceRequests'
import { MAX_PRICE_REQUEST } from '../../src/shared/cloud'
import { seededDb } from './helpers'

const NOW = new Date('2026-10-25T12:00:00.000Z')
const T = NOW.getTime()
const before = (ms: number): string => new Date(T - ms).toISOString()
const DAY = 24 * 3600 * 1000

let db: Database.Database
let n = 0
beforeEach(async () => {
  db = await seededDb()
  n = 0
})
afterEach(() => db.close())

/** A printing of Dark Magician; Japanese unless `lang` says otherwise. */
const printing = (lang = 'ja'): { id: number; pkey: string } =>
  db
    .prepare(
      `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
       VALUES (46986414, ?, 'Test Set', ?, 'Ultra Rare') RETURNING id, pkey`
    )
    .get(lang, `TST-JP${String(++n).padStart(3, '0')}`) as { id: number; pkey: string }
const price = (id: number, checkedAt: string): void => {
  db.prepare(
    'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 5, 2, ?)'
  ).run(id, checkedAt)
}
const requested = (id: number, at: string): void => {
  db.prepare('INSERT INTO price_requests (printing_id, requested_at) VALUES (?, ?)').run(id, at)
}
const fakeClient = (
  impl: (pkeys: string[]) => Promise<{ queued: number; capped: boolean }> = async (pkeys) => ({
    queued: pkeys.length,
    capped: false
  })
): { client: CloudClient; requestPrices: ReturnType<typeof vi.fn> } => {
  const fn = vi.fn(impl)
  return { client: { requestPrices: fn } as unknown as CloudClient, requestPrices: fn }
}

describe('printingsToRequest', () => {
  it('keeps unpriced or stale non-English printings, in the order given', () => {
    const a = printing()
    const fresh = printing()
    const stale = printing()
    const en = printing('en')
    price(fresh.id, before(2 * DAY))
    price(stale.id, before(8 * DAY))
    expect(printingsToRequest(db, [stale.id, en.id, fresh.id, a.id, 424242, a.id], NOW)).toEqual([
      stale,
      a
    ])
  })

  it('skips printings asked for in the last few hours, not older asks', () => {
    const recent = printing()
    const old = printing()
    requested(recent.id, before(REQUEST_AGAIN_MS - 60_000))
    requested(old.id, before(REQUEST_AGAIN_MS + 60_000))
    expect(printingsToRequest(db, [recent.id, old.id], NOW)).toEqual([old])
  })

  it('sends at most the portal limit', () => {
    const ids = Array.from({ length: MAX_PRICE_REQUEST + 5 }, () => printing().id)
    expect(printingsToRequest(db, ids, NOW)).toHaveLength(MAX_PRICE_REQUEST)
  })
})

describe('requestPrices', () => {
  it('sends pkeys, records the ask, and does not ask again', async () => {
    const p = printing()
    const { client, requestPrices: send } = fakeClient()
    await expect(requestPrices(db, client, [p.id], NOW)).resolves.toBe(1)
    expect(send).toHaveBeenCalledWith([p.pkey])
    expect(db.prepare('SELECT requested_at FROM price_requests').all()).toEqual([
      { requested_at: NOW.toISOString() }
    ])
    await expect(requestPrices(db, client, [p.id], NOW)).resolves.toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a failed call records nothing, so the next view asks again', async () => {
    const p = printing()
    const { client } = fakeClient(async () => {
      throw new Error('down')
    })
    await expect(requestPrices(db, client, [p.id], NOW)).rejects.toThrow('down')
    expect(db.prepare('SELECT COUNT(*) AS n FROM price_requests').get()).toEqual({ n: 0 })
  })

  it('nothing worth asking makes no call', async () => {
    const { client, requestPrices: send } = fakeClient()
    await expect(requestPrices(db, client, [printing('en').id], NOW)).resolves.toBe(0)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('after a request', () => {
  it('the sync asks the portal for requested printings, after owned ones', () => {
    const p = printing()
    expect(stalePricePkeys(db, NOW, 10)).not.toContain(p.pkey)
    requested(p.id, before(60_000))
    expect(stalePricePkeys(db, NOW, 10)).toContain(p.pkey)
  })

  it('awaitingPrices holds until a price arrives or a few minutes pass', () => {
    const p = printing()
    expect(awaitingPrices(db, NOW)).toBe(false)
    requested(p.id, before(60_000))
    expect(awaitingPrices(db, NOW)).toBe(true)
    expect(awaitingPrices(db, new Date(T + AWAIT_PRICES_MS))).toBe(false)
    price(p.id, NOW.toISOString())
    expect(awaitingPrices(db, NOW)).toBe(false)
  })
})

it('checkPrintingIds takes only a list of positive whole numbers', () => {
  expect(checkPrintingIds([1, 2])).toEqual([1, 2])
  for (const bad of ['1', [0], [1.5], [-1], ['1'], null])
    expect(() => checkPrintingIds(bad)).toThrow()
})
