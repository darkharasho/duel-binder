import type { SqlDb } from '../db/sql'
import { PRICE_INTERVAL_MS } from '../prices/candidates'
import { MAX_PRICE_REQUEST } from '../../shared/cloud'
import type { CloudClient } from './client'

// Asking the portal to price printings the user is looking at (a scan list, a set checklist) that
// nobody owns yet. The desktop and the phone share this. Each request is recorded in this device's
// price_requests, which (see ../prices/candidates) both keeps it from being sent again soon and makes
// the sync pull the printing's price once the portal has it.

/** A printing is asked for again only this long after the last time (if it still has no price). */
export const REQUEST_AGAIN_MS = 6 * 60 * 60 * 1000
/** How long after a request the device keeps syncing for its prices. */
export const AWAIT_PRICES_MS = 3 * 60 * 1000
/** Between those syncs: the portal's price alarm runs a few seconds after a request, then each minute. */
export const PRICE_REQUEST_FOLLOW_UP_MS = 30_000

/** Checks a list of printing ids from the renderer; throws on anything else. */
export function checkPrintingIds(ids: unknown): number[] {
  if (!Array.isArray(ids) || !ids.every((i) => Number.isSafeInteger(i) && (i as number) > 0))
    throw new Error('Printing ids must be a list of positive whole numbers')
  return ids as number[]
}

/**
 * Of `printingIds`, the printings worth asking the portal for: non-English, with no eBay price or one
 * older than 7 days, not asked for in the last REQUEST_AGAIN_MS; at most MAX_PRICE_REQUEST, in the
 * order given.
 */
export function printingsToRequest(
  db: SqlDb,
  printingIds: number[],
  now: Date
): { id: number; pkey: string }[] {
  const ids = [...new Set(printingIds)]
  if (ids.length === 0) return []
  const rows = db
    .prepare(
      `SELECT p.id, p.pkey FROM card_printings p
       LEFT JOIN intl_prices ip ON ip.printing_id = p.id
       LEFT JOIN price_requests r ON r.printing_id = p.id
       WHERE p.id IN (SELECT value FROM json_each(?))
         AND p.language <> 'en'
         AND (ip.printing_id IS NULL OR ip.checked_at < ?)
         AND (r.printing_id IS NULL OR r.requested_at < ?)`
    )
    .all(
      JSON.stringify(ids),
      new Date(now.getTime() - PRICE_INTERVAL_MS).toISOString(),
      new Date(now.getTime() - REQUEST_AGAIN_MS).toISOString()
    ) as { id: number; pkey: string }[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids
    .flatMap((id) => {
      const r = byId.get(id)
      return r ? [r] : []
    })
    .slice(0, MAX_PRICE_REQUEST)
}

/**
 * Asks the portal to price the printings worth asking for (see printingsToRequest) and records them
 * as asked for. Resolves how many the portal queued (0 when there was nothing to ask). A failed call
 * rejects and records nothing, so the next view asks again.
 */
export async function requestPrices(
  db: SqlDb,
  client: CloudClient,
  printingIds: number[],
  now: Date
): Promise<number> {
  const ask = printingsToRequest(db, printingIds, now)
  if (ask.length === 0) return 0
  const { queued } = await client.requestPrices(ask.map((p) => p.pkey))
  // Printings the portal didn't queue (priced already, asked for by someone else, over a daily limit)
  // are recorded too: asking again within hours wouldn't change the answer.
  const at = now.toISOString()
  const record = db.prepare(
    `INSERT INTO price_requests (printing_id, requested_at) VALUES (?, ?)
     ON CONFLICT(printing_id) DO UPDATE SET requested_at = excluded.requested_at`
  )
  db.transaction(() => {
    for (const p of ask) record.run(p.id, at)
  })()
  return queued
}

/**
 * Whether a printing asked for in the last AWAIT_PRICES_MS still has no eBay price (or only one older
 * than 7 days): worth syncing again shortly to bring it in.
 */
export function awaitingPrices(db: SqlDb, now: Date): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM price_requests r LEFT JOIN intl_prices ip ON ip.printing_id = r.printing_id
         WHERE r.requested_at >= ? AND (ip.printing_id IS NULL OR ip.checked_at < ?)
         LIMIT 1`
      )
      .get(
        new Date(now.getTime() - AWAIT_PRICES_MS).toISOString(),
        new Date(now.getTime() - PRICE_INTERVAL_MS).toISOString()
      ) !== undefined
  )
}
