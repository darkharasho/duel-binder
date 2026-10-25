import type { Language } from '../../shared/languages'
import { setMeta } from '../db/meta'
import type { SqlDb } from '../db/sql'
import type { PriceClient } from './client'

export const PRICE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

export interface PriceCandidate {
  id: number
  pkey: string
  code: string
  name: string
  set: string
  rarity: string
  lang: Language
}

/** WHERE clause and params shared by the candidate list and its count. */
function candidateFilter(now: Date, printingIds?: number[]): { where: string; params: unknown[] } | null {
  const cutoff = new Date(now.getTime() - PRICE_INTERVAL_MS).toISOString()
  const where = ['(ip.printing_id IS NULL OR ip.checked_at < ?)']
  const params: unknown[] = [cutoff]
  if (printingIds) {
    if (printingIds.length === 0) return null
    where.push(`p.id IN (${printingIds.map(() => '?').join(',')})`)
    params.push(...printingIds)
  }
  // Owned by anyone: deliberately global across desktop owners and server users; tombstones don't count.
  where.push('EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = p.id AND e.deleted_at IS NULL)')
  return { where: where.join(' AND '), params }
}

// intl_prices holds eBay prices for every language.
const CANDIDATE_FROM = `FROM card_printings p
       JOIN cards c ON c.id = p.card_id
       LEFT JOIN intl_prices ip ON ip.printing_id = p.id`

/**
 * Owned printings (every language) with no eBay price or one older than 7 days, never-priced first
 * (optionally only `printingIds`, at most `limit`).
 */
export function priceCandidates(
  db: SqlDb,
  now: Date,
  opts: { printingIds?: number[]; limit?: number } = {}
): PriceCandidate[] {
  const f = candidateFilter(now, opts.printingIds)
  if (!f) return []
  const params = [...f.params]
  let limit = ''
  if (opts.limit !== undefined) {
    limit = 'LIMIT ?'
    params.push(opts.limit)
  }
  return db
    .prepare(
      `SELECT p.id, p.pkey, p.set_code AS code, c.name, p.set_name AS "set", p.set_rarity AS rarity, p.language AS lang
       ${CANDIDATE_FROM}
       WHERE ${f.where}
       ORDER BY ip.printing_id IS NULL DESC, ip.checked_at, p.id
       ${limit}`
    )
    .all(...params) as PriceCandidate[]
}

function countCandidates(db: SqlDb, now: Date, printingIds?: number[]): number {
  const f = candidateFilter(now, printingIds)
  if (!f) return 0
  const row = db.prepare(`SELECT COUNT(*) AS n ${CANDIDATE_FROM} WHERE ${f.where}`).get(...f.params) as { n: number }
  return Number(row.n)
}

/** True when the printing (any language) has no eBay price checked in the last 7 days. */
export function needsPrice(db: SqlDb, printingId: number, now = new Date()): boolean {
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
    const upsert = db.prepare(
      `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(printing_id) DO UPDATE SET price = excluded.price,
         listing_count = excluded.listing_count, checked_at = excluded.checked_at`
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
