import type { Language } from '../../shared/languages'
import type { SqlDb } from '../db/sql'

// Which owned printings are due an eBay price. Only reads the database: the desktop sends these to
// the server for pricing, and the price refresh (./refresh) looks them up.

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
function candidateFilter(
  now: Date,
  printingIds?: number[]
): { where: string; params: unknown[] } | null {
  const cutoff = new Date(now.getTime() - PRICE_INTERVAL_MS).toISOString()
  const where = ['(ip.printing_id IS NULL OR ip.checked_at < ?)']
  const params: unknown[] = [cutoff]
  if (printingIds) {
    if (printingIds.length === 0) return null
    where.push(`p.id IN (${printingIds.map(() => '?').join(',')})`)
    params.push(...printingIds)
  }
  // English printings with a TCGplayer market price don't need eBay's.
  where.push("(p.language <> 'en' OR p.market_price IS NULL)")
  // Owned by anyone: deliberately global across desktop owners and server users; tombstones don't count.
  where.push(
    'EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = p.id AND e.deleted_at IS NULL)'
  )
  return { where: where.join(' AND '), params }
}

// intl_prices holds eBay prices for every language.
const CANDIDATE_FROM = `FROM card_printings p
       JOIN cards c ON c.id = p.card_id
       LEFT JOIN intl_prices ip ON ip.printing_id = p.id`

/**
 * Owned printings (every language, English only without a TCGplayer market price) with no eBay price or one older than 7 days, never-priced first
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

export function countCandidates(db: SqlDb, now: Date, printingIds?: number[]): number {
  const f = candidateFilter(now, printingIds)
  if (!f) return 0
  const row = db
    .prepare(`SELECT COUNT(*) AS n ${CANDIDATE_FROM} WHERE ${f.where}`)
    .get(...f.params) as { n: number }
  return Number(row.n)
}
