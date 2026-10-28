import type { SqlDb } from '../../../src/main/db/sql'
import { PRICE_INTERVAL_MS, REQUEST_WINDOW_MS } from '../../../src/main/prices/candidates'
import type { PriceRequestResponse } from '../../../src/shared/cloud'

/**
 * Most printings one user may newly queue for an eBay price per UTC day. A Japanese set checklist is
 * about 100 printings, so this is a couple of unpriced set pages and a scan session a day; printings
 * someone else already asked for, or that are priced, don't count.
 */
export const USER_DAILY_REQUESTS = 200
/**
 * Most printings all users together may newly queue per UTC day. Each lookup is one or two eBay
 * Browse API calls (the eBay Worker caches each query for 7 days), so this keeps requests to about
 * 2,000 calls a day, well inside the Browse API's default 5,000, with room for owned cards' refreshes.
 */
export const DAILY_REQUESTS = 1000

const utcDay = (now: Date): string => now.toISOString().slice(0, 10)

/**
 * Queues printings (by pkey) for the price alarm on behalf of `userId`. Keeps only printings that are
 * non-English, have no eBay price or one older than 7 days, aren't owned by anyone (the alarm prices
 * those anyway) and weren't requested in the last REQUEST_WINDOW_MS; then takes as many as the
 * user's and everyone's daily limits allow, in the order sent. Unknown pkeys are ignored.
 * One transaction; one statement per table.
 */
export function requestPrices(
  db: SqlDb,
  userId: number,
  pkeys: string[],
  now: Date
): PriceRequestResponse {
  const day = utcDay(now)
  const priceCutoff = new Date(now.getTime() - PRICE_INTERVAL_MS).toISOString()
  const requestCutoff = new Date(now.getTime() - REQUEST_WINDOW_MS).toISOString()
  return db.transaction((): PriceRequestResponse => {
    // Expired requests and past days' counts are no longer needed; pruning here keeps both small.
    db.prepare('DELETE FROM price_requests WHERE requested_at < ?').run(requestCutoff)
    db.prepare('DELETE FROM price_request_log WHERE day < ?').run(day)

    const rows = db
      .prepare(
        `SELECT p.id, p.pkey FROM card_printings p
         LEFT JOIN intl_prices ip ON ip.printing_id = p.id
         WHERE p.pkey IN (SELECT value FROM json_each(?))
           AND p.language <> 'en'
           AND (ip.printing_id IS NULL OR ip.checked_at < ?)
           AND NOT EXISTS (SELECT 1 FROM price_requests r WHERE r.printing_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM collection_entries e
                           WHERE e.printing_id = p.id AND e.deleted_at IS NULL)`
      )
      .all(JSON.stringify(pkeys), priceCutoff) as { id: number; pkey: string }[]
    if (rows.length === 0) return { queued: 0, capped: false }
    const idOf = new Map(rows.map((r) => [r.pkey, r.id]))
    const wanted = [...new Set(pkeys)].flatMap((k) => {
      const id = idOf.get(k)
      return id === undefined ? [] : [id]
    })

    const mine = db
      .prepare('SELECT count FROM price_request_log WHERE user_id = ? AND day = ?')
      .get(userId, day) as { count: number } | undefined
    const everyone = db
      .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM price_request_log WHERE day = ?')
      .get(day) as { n: number }
    const room = Math.max(
      0,
      Math.min(USER_DAILY_REQUESTS - Number(mine?.count ?? 0), DAILY_REQUESTS - Number(everyone.n))
    )
    const take = wanted.slice(0, room)
    if (take.length > 0) {
      const at = now.toISOString()
      const insert = db.prepare(
        `INSERT INTO price_requests (printing_id, requested_at) VALUES (?, ?)
         ON CONFLICT(printing_id) DO UPDATE SET requested_at = excluded.requested_at`
      )
      for (const id of take) insert.run(id, at)
      db.prepare(
        `INSERT INTO price_request_log (user_id, day, count) VALUES (?, ?, ?)
         ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count`
      ).run(userId, day, take.length)
    }
    return { queued: take.length, capped: take.length < wanted.length }
  })()
}
