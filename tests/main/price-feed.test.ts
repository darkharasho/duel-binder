import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudClient } from '../../src/main/cloud/client'
import { pullPriceChanges } from '../../src/main/cloud/localSync'
import { getMeta } from '../../src/main/db/meta'
import type { PriceChange, PriceChangesResponse } from '../../src/shared/cloud'
import { seededDb } from './helpers'

const T = '2026-10-25T12:00:00.000Z'

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
})
afterEach(() => db.close())

const pkeys = (): string[] =>
  (
    db.prepare('SELECT pkey FROM card_printings ORDER BY id LIMIT 3').all() as { pkey: string }[]
  ).map((r) => r.pkey)
const change = (pkey: string, seq: number, price: number): PriceChange => ({
  pkey,
  price,
  listingCount: 2,
  checkedAt: T,
  seq
})
const client = (
  pages: PriceChangesResponse[]
): { client: Pick<CloudClient, 'priceChanges'>; ask: ReturnType<typeof vi.fn> } => {
  const queue = [...pages]
  const ask = vi.fn<(since: number) => Promise<PriceChangesResponse>>(async () => queue.shift()!)
  return { client: { priceChanges: ask }, ask }
}
const stored = (): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM intl_prices').get() as { n: number }).n

describe('pullPriceChanges', () => {
  it('pages to the end and skips unknown pkeys', async () => {
    const [k1, k2] = pkeys()
    const { client: c, ask } = client([
      { prices: [change(k1, 5, 1.5)], cursor: 5, more: true },
      { prices: [change('ja|NOPE|X-001|Rare', 6, 9)], cursor: 6, more: true },
      { prices: [change(k2, 9, 2.5)], cursor: 9, more: false }
    ])
    await expect(pullPriceChanges(db, c)).resolves.toBe(2)
    expect(ask.mock.calls.map((x) => x[0])).toEqual([0, 5, 6])
    expect(stored()).toBe(2)
    expect(
      db
        .prepare(
          'SELECT p.pkey, i.price FROM intl_prices i JOIN card_printings p ON p.id = i.printing_id ORDER BY i.price'
        )
        .all()
    ).toEqual([
      { pkey: k1, price: 1.5 },
      { pkey: k2, price: 2.5 }
    ])
    expect(getMeta(db, 'price_feed_cursor')).toBe('9')
  })

  it('never erases a local price with a server null', async () => {
    const [k1] = pkeys()
    const id = (
      db.prepare('SELECT id FROM card_printings WHERE pkey = ?').get(k1) as { id: number }
    ).id
    db.prepare(
      'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 4, 3, ?)'
    ).run(id, '2026-10-20T00:00:00.000Z')
    const { client: c } = client([
      {
        prices: [{ pkey: k1, price: null, listingCount: 0, checkedAt: T, seq: 7 }],
        cursor: 7,
        more: false
      }
    ])
    await pullPriceChanges(db, c)
    expect(
      db
        .prepare('SELECT price, listing_count, checked_at FROM intl_prices WHERE printing_id = ?')
        .get(id)
    ).toEqual({
      price: 4,
      listing_count: 3,
      checked_at: T
    })
  })

  it('resumes from the saved cursor', async () => {
    const [k1, k2] = pkeys()
    await pullPriceChanges(
      db,
      client([{ prices: [change(k1, 4, 1)], cursor: 4, more: false }]).client
    )
    const { client: c, ask } = client([{ prices: [change(k2, 7, 2)], cursor: 7, more: false }])
    await expect(pullPriceChanges(db, c)).resolves.toBe(1)
    expect(ask).toHaveBeenCalledWith(4, 'ygo')
    expect(getMeta(db, 'price_feed_cursor')).toBe('7')
  })
})
