import { setMeta } from '../db/meta'
import type { SqlDb } from '../db/sql'
import type { PriceClient } from './client'
import { countCandidates, PRICE_INTERVAL_MS, priceCandidates } from './candidates'

export { PRICE_INTERVAL_MS, priceCandidates, type PriceCandidate } from './candidates'

/**
 * True when the printing (any language) has no eBay price checked in the last 7 days, unless it is an
 * English printing with a TCGplayer market price.
 */
export function needsPrice(db: SqlDb, printingId: number, now = new Date()): boolean {
  const cutoff = new Date(now.getTime() - PRICE_INTERVAL_MS).toISOString()
  const row = db
    .prepare(
      `SELECT ip.checked_at AS checkedAt, p.language = 'en' AND p.market_price IS NOT NULL AS priced
       FROM card_printings p LEFT JOIN intl_prices ip ON ip.printing_id = p.id WHERE p.id = ?`
    )
    .get(printingId) as { checkedAt: string | null; priced: number } | undefined
  if (!row || row.priced) return false
  return row.checkedAt === null || row.checkedAt < cutoff
}

/**
 * Looks up eBay asking prices for owned or requested printings (see priceCandidates) with no price row or one older than 7 days
 * (optionally only `printingIds`, at most `limit`, never-priced first). `remaining` counts the candidates left
 * past `limit`. Sequential. Never rejects.
 */
export async function refreshIntlPrices(
  db: SqlDb,
  client: PriceClient | null,
  opts: { now?: Date; printingIds?: number[]; limit?: number } = {}
): Promise<{ updated: number; failed: number; remaining: number }> {
  let updated = 0
  let failed = 0
  let remaining = 0
  try {
    if (!client) {
      setMeta(db, 'price_service_status', 'unavailable')
      return { updated, failed, remaining }
    }
    const now = opts.now ?? new Date()
    // A lookup that finds nothing never erases a price: it keeps the price and its listing count and
    // only stamps checked_at, so the row stops being a candidate. A new row with no price still records
    // the check.
    const upsert = db.prepare(
      `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(printing_id) DO UPDATE SET price = COALESCE(excluded.price, intl_prices.price),
         listing_count = CASE WHEN excluded.price IS NULL AND intl_prices.price IS NOT NULL
           THEN intl_prices.listing_count ELSE excluded.listing_count END,
         checked_at = excluded.checked_at`
    )
    const batch = priceCandidates(db, now, { printingIds: opts.printingIds, limit: opts.limit })
    if (opts.limit !== undefined) remaining = Math.max(0, countCandidates(db, now, opts.printingIds) - batch.length)
    for (const c of batch) {
      try {
        const r = await client.lookup({ code: c.code, name: c.name, set: c.set, rarity: c.rarity, lang: c.lang })
        upsert.run(c.id, r.price, r.listingCount, r.checkedAt)
        updated++
      } catch (e) {
        failed++
        // Status text only (PriceUnavailableError messages carry no URLs or env).
        console.warn('Price lookup failed:', e instanceof Error ? e.message : String(e))
      }
    }
    if (updated > 0) setMeta(db, 'price_service_status', 'ok')
    else if (failed > 0) setMeta(db, 'price_service_status', 'unavailable')
  } catch (e) {
    console.error('Price refresh failed', e)
  }
  return { updated, failed, remaining }
}
