import type Database from 'better-sqlite3'
import type { Language } from '@shared/languages'
import { setMeta } from '../db/meta'
import type { PriceClient } from './client'

export const PRICE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

interface Candidate {
  id: number
  code: string
  name: string
  set: string
  rarity: string
  lang: Language
}

function candidates(db: Database.Database, now: Date, printingIds?: number[]): Candidate[] {
  const cutoff = new Date(now.getTime() - PRICE_INTERVAL_MS).toISOString()
  const where = ['(ip.printing_id IS NULL OR ip.checked_at < ?)']
  const params: unknown[] = [cutoff]
  if (printingIds) {
    if (printingIds.length === 0) return []
    where.push(`p.id IN (${printingIds.map(() => '?').join(',')})`)
    params.push(...printingIds)
  }
  return db
    .prepare(
      `SELECT p.id, p.set_code AS code, c.name, p.set_name AS "set", p.set_rarity AS rarity, p.language AS lang
       FROM card_printings p
       JOIN cards c ON c.id = p.card_id
       LEFT JOIN intl_prices ip ON ip.printing_id = p.id -- holds eBay prices for every language
       WHERE ${where.join(' AND ')}
         AND EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = p.id AND e.deleted_at IS NULL)
       ORDER BY p.id`
    )
    .all(...params) as Candidate[]
}

/** True when the printing (any language) has no eBay price checked in the last 7 days. */
export function needsPrice(db: Database.Database, printingId: number, now = new Date()): boolean {
  const cutoff = new Date(now.getTime() - PRICE_INTERVAL_MS).toISOString()
  const row = db
    .prepare(
      `SELECT ip.checked_at AS checkedAt
       FROM card_printings p LEFT JOIN intl_prices ip ON ip.printing_id = p.id WHERE p.id = ?`
    )
    .get(printingId) as { checkedAt: string | null } | undefined
  if (!row) return false
  return row.checkedAt === null || row.checkedAt < cutoff
}

/**
 * Looks up eBay asking prices for owned printings (every language) with no price row or one older than 7 days
 * (optionally only `printingIds`). Sequential. Never rejects.
 */
export async function refreshIntlPrices(
  db: Database.Database,
  client: PriceClient | null,
  opts: { now?: Date; printingIds?: number[] } = {}
): Promise<{ updated: number; failed: number }> {
  let updated = 0
  let failed = 0
  try {
    if (!client) {
      setMeta(db, 'price_service_status', 'unavailable')
      return { updated, failed }
    }
    const now = opts.now ?? new Date()
    const upsert = db.prepare(
      `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(printing_id) DO UPDATE SET price = excluded.price,
         listing_count = excluded.listing_count, checked_at = excluded.checked_at`
    )
    for (const c of candidates(db, now, opts.printingIds)) {
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
  return { updated, failed }
}
