import type { Language } from '../../shared/languages'
import type { SqlDb } from '../db/sql'

// Which printings are due an eBay price: owned ones, and ones someone asked to have priced. Only reads
// the database: the desktop sends these to the server for pricing, and the price refresh (./refresh)
// looks them up.

export const PRICE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
/**
 * A price request keeps a printing wanted this long. The same as PRICE_INTERVAL_MS: a requested
 * printing is priced once, and its price isn't refreshed unless someone asks again (or owns it).
 */
export const REQUEST_WINDOW_MS = PRICE_INTERVAL_MS

export interface PriceCandidate {
  id: number
  pkey: string
  code: string
  name: string
  set: string
  rarity: string
  lang: Language
  /** How many rarities this set code has in this language (see RARITIES). */
  rarities: number
}

// Owned by anyone: deliberately global across desktop owners and server users; tombstones don't count.
const OWNED =
  'EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = p.id AND e.deleted_at IS NULL)'
// Owned or recently requested printings. The filter starts from these rather than testing every catalog
// printing (~340k), which on a desktop meant a sync froze the app for as long as a minute.
const WANTED = `p.id IN (SELECT printing_id FROM collection_entries WHERE deleted_at IS NULL
       UNION SELECT printing_id FROM price_requests WHERE requested_at >= ?)`

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
  // The eBay query builder is Yu-Gi-Oh!-specific, so only Yu-Gi-Oh! printings are priced there.
  where.push("+p.game = 'ygo'")
  // English printings with a TCGplayer market price don't need eBay's.
  where.push("(p.language <> 'en' OR p.market_price IS NULL)")
  where.push(WANTED)
  params.push(new Date(now.getTime() - REQUEST_WINDOW_MS).toISOString())
  return { where: where.join(' AND '), params }
}

/**
 * The rarity a printing is priced as: its own, with a Manga-Style tone kept in its variant added
 * ("Ultra Rare (Manga-Style, Color)"), as the Monochrome one carries it in its rarity, so the price
 * Worker keeps to listings of that tone. Other variants are left out, as before.
 */
const PRICED_RARITY = `p.set_rarity || CASE WHEN p.variant LIKE '%, Color' OR p.variant LIKE '%, Monochrome'
  THEN ' (' || p.variant || ')' ELSE '' END`

/**
 * How many rarities the printing's set code has in its language: RV01-KR005 comes in Ultra, Secret
 * and Prismatic Secret, so 3. The price Worker then counts only listings naming the asked rarity, so
 * one rarity's price isn't put on the others. A blank code counts as 1.
 */
const RARITIES = `CASE WHEN p.set_code = '' THEN 1 ELSE (SELECT COUNT(DISTINCT q.set_rarity) FROM card_printings q
  WHERE q.set_code = p.set_code COLLATE NOCASE AND q.language = p.language AND +q.game = p.game) END`

// intl_prices holds eBay prices for every language.
const CANDIDATE_FROM = `FROM card_printings p
       JOIN cards c ON c.id = p.card_id
       LEFT JOIN intl_prices ip ON ip.printing_id = p.id`

/**
 * Owned or recently requested printings (every language, English only without a TCGplayer market
 * price) with no eBay price or one older than 7 days (optionally only `printingIds`, at most `limit`).
 * Owned printings come first, so requests never hold up a collection's prices; then never-priced first.
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
      `SELECT p.id, p.pkey, p.set_code AS code, c.name, p.set_name AS "set", ${PRICED_RARITY} AS rarity, p.language AS lang,
         ${RARITIES} AS rarities
       ${CANDIDATE_FROM}
       WHERE ${f.where}
       ORDER BY ${OWNED} DESC, ip.printing_id IS NULL DESC, ip.checked_at, p.id
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
