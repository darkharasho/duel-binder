// Graded prices: what eBay asks for the slabs people own, one printing at one grader's grade, kept
// in graded_prices (desktop V50, on both sides) and handed to each device for its own slabs.
import type { SqlDb } from '../../../src/main/db/sql'
import { getMeta, setMeta } from '../../../src/main/db/meta'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  createGradedPriceClient,
  type GradedPriceClient,
  type GradedPriceQuery
} from '../../../src/main/prices/client'
import {
  MAX_GRADED_PRICE_KEYS,
  type GradedPriceKey,
  type GradedPricesResponse,
  type WireGradedPrice
} from '../../../src/shared/cloud'
import { GRADES, GRADING_COMPANIES } from '../../../src/shared/graded'
import { isLanguage } from '../../../src/shared/languages'
import type { PriceEnv } from './prices'
import { MAX_PKEY } from './sync'

/** A slab's price is looked up again after this long. */
export const GRADED_PRICE_INTERVAL_MS = 7 * 24 * 3600 * 1000
/** Lookups per alarm run. */
export const GRADED_BATCH = 10
/** Browse calls a day for graded prices: one per lookup. */
export const GRADED_DAILY_CALLS = 150

const META_CALLS = 'graded_calls_day'

/** The graded client, or null when PRICE_WORKER_URL is empty; through the PRICES binding as priceClientFor. */
export function gradedClientFor(env: PriceEnv): GradedPriceClient | null {
  if (!env.PRICE_WORKER_URL) return null
  const binding = env.PRICES
  return createGradedPriceClient({
    url: env.PRICE_WORKER_URL,
    ...(binding
      ? { fetchFn: (input: RequestInfo | URL, init?: RequestInit) => binding.fetch(input, init) }
      : {})
  })
}

interface Candidate {
  game: string
  pkey: string
  company: string
  grade: string
}

interface PrintingRow {
  set_code: string
  set_name: string
  set_rarity: string
  language: string
  name: string
  first_in_set: number
}

/**
 * The collector number in a set code, with the set's total when it prints one: "FO 4/62" →
 * "4/62", "M5 065/81" → "65/81", "ONE 75" → "75"; '' when the code holds none.
 */
export function collectorNumber(setCode: string): string {
  const m = /^\S+\s+0*(\d+[A-Za-z]?|[A-Za-z]+\d+)(?:\/0*([A-Za-z]*\d+))?$/.exec(setCode.trim())
  if (!m) return ''
  return m[2] ? `${m[1]}/${m[2]}` : m[1]
}

/**
 * The eBay Worker's query for a slab, or null when it can't be searched for (a grader the Worker
 * doesn't know, or a printing with neither a code nor a number).
 */
export function gradedQuery(c: Candidate, p: PrintingRow): GradedPriceQuery | null {
  if (!(GRADING_COMPANIES as readonly string[]).includes(c.company)) return null
  if (!GRADES.includes(c.grade)) return null
  if (!isLanguage(p.language)) return null
  const base = { game: c.game, lang: p.language, company: c.company, grade: c.grade }
  if (c.game === 'ygo' || c.game === 'op') {
    // Yu-Gi-Oh! and One Piece codes name one card: LOB-EN001, OP02-105. A DON!! has none.
    if (!/^[A-Z0-9]+-[A-Z]*\d+[A-Z]?$/i.test(p.set_code)) return null
    return { ...base, code: p.set_code, name: p.name, number: '', set: p.set_name, edition: '' }
  }
  const number = collectorNumber(p.set_code)
  if (!number) return null
  const edition = /\b1st Edition\b/i.test(p.set_rarity) ? '1st' : p.first_in_set ? 'unlimited' : ''
  return { ...base, code: '', name: p.name, number, set: p.set_name, edition }
}

function readCalls(db: SqlDb, today: string): number {
  const v = getMeta(db, META_CALLS)
  if (!v) return 0
  const [day, n] = v.split(':')
  return day === today ? Number(n) || 0 : 0
}

/**
 * One alarm's worth of graded prices: up to `limit` keys of live slabs with no price yet or one
 * older than GRADED_PRICE_INTERVAL_MS (never priced first), one eBay call each, within the day's
 * GRADED_DAILY_CALLS. A key that can't be searched for is stored unpriced, so it waits a week too.
 * A lookup that finds too few listings keeps the price there was. `more` means keys and budget
 * remain. Never throws for one key's failure.
 */
export async function runGradedPrices(
  db: SqlDb,
  client: GradedPriceClient | null,
  now: Date,
  opts: { limit?: number; dailyCalls?: number } = {}
): Promise<{ priced: number; failed: number; more: boolean }> {
  const out = { priced: 0, failed: 0, more: false }
  if (!client) return out
  const today = now.toISOString().slice(0, 10)
  const daily = opts.dailyCalls ?? GRADED_DAILY_CALLS
  let used = readCalls(db, today)
  const room = Math.min(opts.limit ?? GRADED_BATCH, daily - used)
  if (room <= 0) return out
  const stale = new Date(now.getTime() - GRADED_PRICE_INTERVAL_MS).toISOString()
  const due = (limit: number): Candidate[] =>
    db
      .prepare(
        `SELECT g.game, g.pkey, g.company, g.grade, MAX(gp.checked_at) AS checked
         FROM graded_copies g
         LEFT JOIN graded_prices gp ON gp.pkey = g.pkey AND gp.company = g.company AND gp.grade = g.grade
         WHERE g.deleted_at IS NULL
         GROUP BY g.pkey, g.company, g.grade
         HAVING checked IS NULL OR checked < ?
         ORDER BY checked IS NOT NULL, checked
         LIMIT ?`
      )
      .all(stale, limit) as Candidate[]
  const printing = db.prepare(
    `SELECT p.set_code, p.set_name, p.set_rarity, p.language, c.name,
       EXISTS (SELECT 1 FROM card_printings o WHERE o.card_id = p.card_id AND o.set_code = p.set_code
         AND o.language = p.language AND o.set_rarity LIKE '%1st Edition%') AS first_in_set
     FROM card_printings p JOIN cards c ON c.id = p.card_id WHERE p.pkey = ?`
  )
  const write = db.prepare(
    `INSERT INTO graded_prices (pkey, company, grade, price, listing_count, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(pkey, company, grade) DO UPDATE SET price = COALESCE(excluded.price, price),
       listing_count = CASE WHEN excluded.price IS NULL THEN listing_count ELSE excluded.listing_count END,
       checked_at = excluded.checked_at`
  )
  for (const c of due(room)) {
    const p = printing.get(c.pkey) as PrintingRow | undefined
    const q = p ? gradedQuery(c, p) : null
    if (!q) {
      // Nothing to search for (or the printing isn't in the catalog yet): wait a week.
      write.run(c.pkey, c.company, c.grade, null, 0, now.toISOString())
      continue
    }
    used++
    try {
      const r = await client.lookup(q)
      write.run(c.pkey, c.company, c.grade, r.price, r.listingCount, r.checkedAt)
      out.priced++
    } catch (e) {
      out.failed++
      console.error('Graded price failed', e instanceof Error ? e.message : '')
      // Back off a day: due again tomorrow, so one bad key can't hold the head of the queue.
      const back = new Date(now.getTime() - GRADED_PRICE_INTERVAL_MS + 24 * 3600 * 1000)
      write.run(c.pkey, c.company, c.grade, null, 0, back.toISOString())
    }
  }
  setMeta(db, META_CALLS, `${today}:${used}`)
  out.more = used < daily && due(1).length > 0
  return out
}

/** Checks a POST /api/sync/graded-prices body; throws CollectionError (a 400) on anything malformed. */
export function checkGradedPriceKeys(body: unknown): GradedPriceKey[] {
  const keys = (body as { keys?: unknown } | null)?.keys
  if (!Array.isArray(keys)) throw new CollectionError('keys must be an array')
  if (keys.length > MAX_GRADED_PRICE_KEYS)
    throw new CollectionError(`at most ${MAX_GRADED_PRICE_KEYS} keys`)
  return keys.map((k) => {
    const o = k as Partial<GradedPriceKey> | null
    if (
      !o ||
      typeof o.pkey !== 'string' ||
      !o.pkey ||
      o.pkey.length > MAX_PKEY ||
      typeof o.company !== 'string' ||
      o.company.length > 24 ||
      typeof o.grade !== 'string' ||
      o.grade.length > 16
    )
      throw new CollectionError('each key needs pkey, company and grade')
    return { pkey: o.pkey, company: o.company, grade: o.grade }
  })
}

/** The graded prices known for `keys`; a key with none yet is left out. */
export function gradedPricesFor(db: SqlDb, keys: GradedPriceKey[]): GradedPricesResponse {
  const get = db.prepare(
    `SELECT pkey, company, grade, price, listing_count, checked_at FROM graded_prices
     WHERE pkey = ? AND company = ? AND grade = ?`
  )
  const prices: WireGradedPrice[] = []
  for (const k of keys) {
    const r = get.get(k.pkey, k.company, k.grade) as
      | {
          pkey: string
          company: string
          grade: string
          price: number | null
          listing_count: number
          checked_at: string
        }
      | undefined
    if (r)
      prices.push({
        pkey: r.pkey,
        company: r.company,
        grade: r.grade,
        price: r.price,
        listingCount: r.listing_count,
        checkedAt: r.checked_at
      })
  }
  return { prices }
}
