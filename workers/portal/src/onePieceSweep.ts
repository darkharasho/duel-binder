import type { SqlDb } from '../../../src/main/db/sql'
import { getMeta, setMeta } from '../../../src/main/db/meta'
import { askingPrice, isSingleCard, keptPrices } from '../../ebay-prices/src/price.js'
import {
  BAD_CONDITION,
  FAKE,
  MAX_SPREAD,
  MIN_SELLERS,
  SEVERAL,
  SLAB,
  SPREAD_SELLERS,
  pokemonCallsLeft,
  readSweepDay,
  yugiohDue,
  yugiohReserve
} from './pokemonSweep'
import {
  DAY_MS,
  ONEPIECE_KEY_PREFIX,
  SWEEP_DAILY_CALLS,
  SWEEP_RESERVE,
  SweepRateLimited,
  WEEK_MS,
  readCalls,
  utcDay,
  type PokemonListing,
  type PokemonListings,
  type SweepClient
} from './sweep'

/**
 * The weekly eBay sweep of Japanese One Piece cards (the One Piece design's Step 5a). TCGCSV has no
 * Japanese One Piece, so eBay is their only price, and a wrong price is worse than none: a listing
 * counts only if its title is one raw Japanese single with one card number in the swept prefix, and
 * it prices a printing only when its version words point at exactly one printing of that number.
 * Each seller counts once, and a price needs MIN_SELLERS of them.
 *
 * Off unless ONEPIECE_SWEEP_DAILY_CALLS (wrangler.toml) is set. Budget: it shares SWEEP_DAILY_CALLS,
 * takes only what Yu-Gi-Oh! can't need and what Pokémon hasn't spent of its own allowance today; see
 * `runOnePieceSweep`. Rows live in price_sweeps with `op:` keys, by number prefix (`op:OP05`), so an SP
 * of OP05-119 sold in OP17 is swept with OP05's listings.
 */

export const ONEPIECE_SWEEP_LANGUAGES = ['ja'] as const
/** A higher setting is a typo, not a plan. */
export const ONEPIECE_MAX_DAILY_CALLS = 200
/** Browse calls a prefix can cost (the price Worker's ONEPIECE_MAX_PAGES). */
export const ONEPIECE_SET_CALLS = 3
/** Prefixes per alarm. */
export const ONEPIECE_SWEEP_BATCH = 6
/** Days the queue is spread over, as Pokémon's. */
export const ONEPIECE_SWEEP_DAYS = 6

const LISTED_META = 'price_sweeps_op_listed_at'
const DAY_META = 'sweep_onepiece_day'

/** The setting's value: a whole number of calls, or 0 (off) for anything else. */
export function onePieceDailyCalls(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? Math.min(n, ONEPIECE_MAX_DAILY_CALLS) : 0
}

/** `OP17-005` → `OP17`; null for a prefix too short to search (`P-084`) or anything else. */
export function opPrefixOf(number: string): string | null {
  const m = /^([A-Z]{2,3}[0-9]{2})-[0-9]{3}$/.exec(number)
  return m ? m[1] : null
}

/** The versions a title can name, and a printing label can be. */
export type OpListingKind = 'base' | 'parallel' | 'manga' | 'super' | 'wanted' | 'sp' | 'tr'

const TR = /\btr\b|\btreasure\b/i
const SP = /\bsp\b|\bspc\b|\bsp\s*card\b|\bspecial\s*card\b/i
const MANGA = /\bmanga\b|\bcomic\b/i
const SUPER = /\bsuper\s*(?:parallel|alt(?:ernate)?(?:\s*art)?)\b|\bsaa\b/i
const WANTED = /\bwanted\b/i
const PARALLEL = /\bparallel\b|\balt(?:ernate)?(?:\s*art)?\b|\baa\b|\bp\d\b/i

/** The version a title names, 'base' for none, or null when it names two that can't both be. */
export function listingKind(title: string): OpListingKind | null {
  const tr = TR.test(title)
  const sp = SP.test(title)
  if (tr && sp) return null
  if (tr) return 'tr'
  if (sp) return 'sp'
  if (MANGA.test(title)) return 'manga'
  if (SUPER.test(title)) return 'super'
  if (WANTED.test(title)) return 'wanted'
  if (PARALLEL.test(title)) return 'parallel'
  return 'base'
}

/** The version a printing label stands for; null for a reprint, a promo or anything unknown. */
export function printingKind(label: string): OpListingKind | null {
  const m = /^(\S+)(?: \((.+)\))?$/.exec(label)
  if (!m) return null
  const [, rarity, inner] = m
  const bare = inner === undefined || /^\d+$/.test(inner)
  if (rarity === 'SP') return bare ? 'sp' : null
  if (rarity === 'TR') return bare ? 'tr' : null
  if (bare) return 'base'
  const v = inner.replace(/ \d+$/, '')
  if (v === 'Parallel' || v === 'Alternate Art') return 'parallel'
  if (v === 'Manga') return 'manga'
  if (v === 'Super Alternate Art' || v === 'Super Parallel') return 'super'
  if (v === 'Wanted Poster') return 'wanted'
  return null
}

const JAPANESE = /\bjapan(?:ese)?\b|\bjpn?\b|日本語|日本版|日版/i
const OTHER_LANGUAGE =
  /\benglish\b|\beng?\b|\bchinese\b|\bcn\b|\bsimplified\b|\btraditional\b|\bkorean\b|\bkr\b|\bthai\b|\bfrench\b|\basian?\b|中文|简体|繁體|韓国/i
/** Sealed product, supplies and lots; "poster" stays out of it (a Wanted Poster is a version). */
const NOT_A_CARD =
  /\b(?:booster|sealed|box|tin|starter\s+deck|deck\s+set|sleeves?|playmat|binder|cases?|display|acrylic|frame[ds]?|figures?|keychain|lot|bundle|card\s+set|set\s+of)\b/i
/** Event, promotional and special printings: other printings than the catalog's, or not priced here. */
const OTHER_PRINTING =
  /\b(?:promos?|stamp(?:ed)?|pre-?release|championship|champion|flagship|winners?|finalists?|top\s*\d+|regionals?|tournament|event|anniversary|serial|signed|signature|autograph|errors?|misprints?|jumbo|oversized?|gold(?:en)?|box\s*topper|topper|judge|staff|celebration)\b|\bdon!!|\bdon\s+card\b/i
const NUMBER = /(?<![A-Za-z0-9])([A-Za-z]{2,3})-?(\d{2})-(\d{3})(?![0-9])/g

export interface OpParsedListing {
  number: string
  kind: OpListingKind
}

/**
 * What one title is a listing of, or null unless it is plainly one raw Japanese single with one card
 * number, in `prefix`, and at most one version.
 */
export function parseOnePieceListing(title: string, prefix: string): OpParsedListing | null {
  if (!JAPANESE.test(title) || OTHER_LANGUAGE.test(title) || !isSingleCard(title)) return null
  if ([SLAB, SEVERAL, NOT_A_CARD, FAKE, BAD_CONDITION, OTHER_PRINTING].some((re) => re.test(title)))
    return null
  const numbers = new Set(
    [...title.matchAll(NUMBER)].map((m) => `${m[1].toUpperCase()}${m[2]}-${m[3]}`)
  )
  if (numbers.size !== 1) return null
  const number = [...numbers][0]
  if (opPrefixOf(number) !== prefix) return null
  const kind = listingKind(title)
  return kind ? { number, kind } : null
}

export interface OpSetPrinting {
  id: number
  /** The printed number (`OP05-119`). */
  code: string
  /** The printing label (`SEC (Manga)`). */
  version: string
}

/**
 * The prices one prefix's listings support, by printing id. A listing prices a printing only when
 * exactly one printing of its number has the version its title names.
 */
export function onePieceSetPrices(
  items: PokemonListing[],
  printings: OpSetPrinting[],
  prefix: string
): Map<number, { price: number; listingCount: number }> {
  // number -> kind -> the one printing of that kind (null: two or more)
  const byNumber = new Map<string, Map<OpListingKind, OpSetPrinting | null>>()
  for (const p of printings) {
    const kind = printingKind(p.version)
    if (!kind) continue
    let kinds = byNumber.get(p.code)
    if (!kinds) byNumber.set(p.code, (kinds = new Map()))
    kinds.set(kind, kinds.has(kind) ? null : p)
  }
  // printing id -> seller -> their cheapest copy
  const seen = new Map<number, Map<string, number>>()
  for (const item of items) {
    if (!item.seller || !Number.isFinite(item.price)) continue
    const parsed = parseOnePieceListing(item.title, prefix)
    if (!parsed) continue
    const p = byNumber.get(parsed.number)?.get(parsed.kind)
    if (!p) continue
    let sellers = seen.get(p.id)
    if (!sellers) seen.set(p.id, (sellers = new Map()))
    sellers.set(item.seller, Math.min(sellers.get(item.seller) ?? Infinity, item.price))
  }
  const out = new Map<number, { price: number; listingCount: number }>()
  for (const [id, sellers] of seen) {
    const asked = [...sellers.values()]
    const { price, listingCount } = askingPrice(asked)
    if (price === null || listingCount < MIN_SELLERS) continue
    const kept = keptPrices(asked)
    if (listingCount < SPREAD_SELLERS && kept[kept.length - 1] / kept[0] > MAX_SPREAD) continue
    out.set(id, { price, listingCount })
  }
  return out
}

/**
 * SQL condition on `p`: not a printing of the promotion and other-product pages, whose labels name an
 * event and are never swept. A subquery, read once, so the planner stays on the printing's indexes.
 */
const SWEPT_SET = `p.set_name NOT IN (SELECT set_name FROM sets WHERE game = 'op' AND language = 'ja' AND set_code IN ('P', 'OPC'))`

/**
 * Lists every Japanese One Piece number prefix, at most once a UTC day. As with Pokémon, `owned`
 * marks a prefix with a live collection entry; swept_at is never touched. No set dates: Japanese
 * sets have none.
 */
export function refreshOnePieceQueue(db: SqlDb, now: Date): number {
  const today = utcDay(now)
  if (getMeta(db, LISTED_META) === today) return 0
  const codes = db.prepare(
    `SELECT p.set_code,
       EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = p.id AND e.deleted_at IS NULL) AS owned
     FROM card_printings p WHERE p.language = ? AND +p.game = 'op' AND p.contributed = 0 AND ${SWEPT_SET}`
  )
  const upsert = db.prepare(
    `INSERT INTO price_sweeps (key, language, owned) VALUES (?, ?, ?)
     ON CONFLICT(key, language) DO UPDATE SET owned = excluded.owned WHERE price_sweeps.owned IS NOT excluded.owned`
  )
  let n = 0
  db.transaction(() => {
    for (const language of ONEPIECE_SWEEP_LANGUAGES) {
      const prefixes = new Map<string, boolean>()
      for (const r of codes.all(language) as { set_code: string; owned: number }[]) {
        const prefix = opPrefixOf(r.set_code)
        if (prefix) prefixes.set(prefix, (prefixes.get(prefix) ?? false) || r.owned === 1)
      }
      for (const [prefix, owned] of prefixes) {
        upsert.run(`${ONEPIECE_KEY_PREFIX}${prefix}`, language, owned ? 1 : 0)
        n++
      }
    }
    setMeta(db, LISTED_META, today)
  })()
  return n
}

/** A prefix's unpriced-by-market Japanese printings. The plus signs keep the planner on the set-code index. */
export const ONEPIECE_PRINTINGS_SQL = `SELECT p.id AS id, p.set_code AS code, p.set_rarity AS version
  FROM card_printings p
  WHERE +p.language = 'ja' AND +p.game = 'op' AND p.set_code LIKE ? AND +p.contributed = 0
    AND +p.missing_from_api = 0 AND p.market_price IS NULL AND ${SWEPT_SET}`

/** Writes one prefix's result. Never erases: a card with no good listings this week keeps its last price. */
export function assignOnePieceSweep(
  db: SqlDb,
  prefix: string,
  language: string,
  result: PokemonListings,
  now: Date
): { priced: number } {
  const printings = db.prepare(ONEPIECE_PRINTINGS_SQL).all(`${prefix}-%`) as OpSetPrinting[]
  const prices = onePieceSetPrices(result.items, printings, prefix)
  const checkedAt = result.checkedAt ?? now.toISOString()
  const upsert = db.prepare(
    `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(printing_id) DO UPDATE SET price = excluded.price,
       listing_count = excluded.listing_count, checked_at = excluded.checked_at`
  )
  db.transaction(() => {
    for (const [id, p] of prices) upsert.run(id, p.price, p.listingCount, checkedAt)
    db.prepare(
      'UPDATE price_sweeps SET swept_at = ?, calls = calls + ? WHERE key = ? AND language = ?'
    ).run(now.toISOString(), result.calls ?? 1, `${ONEPIECE_KEY_PREFIX}${prefix}`, language)
  })()
  return { priced: prices.size }
}

/**
 * One alarm's One Piece sweep. Runs only if `dailyCalls` is on and no Yu-Gi-Oh! prefix is due. It
 * spends only what is left after Yu-Gi-Oh!'s reserve and what Pokémon may still spend today of
 * `pokemonDailyCalls`, so neither sweep changes; it stands down if the eBay quota is unknown or near
 * the reserve. Its calls count on the shared day. Returns prefixes swept and calls spent.
 */
export async function runOnePieceSweep(
  db: SqlDb,
  client: SweepClient | null,
  now: Date,
  dailyCalls: number,
  pokemonDailyCalls: number
): Promise<{ swept: number; calls: number }> {
  const stopped = { swept: 0, calls: 0 }
  if (!client || dailyCalls <= 0) return stopped
  refreshOnePieceQueue(db, now)
  if (yugiohDue(db, now)) return stopped
  const today = utcDay(now)
  const dueBefore = new Date(now.getTime() - WEEK_MS).toISOString()

  const day = readSweepDay(db, DAY_META, today)
  const used = readCalls(db, today)
  const reserve = yugiohReserve(db, now) + pokemonCallsLeft(db, now, pokemonDailyCalls)
  const calls = Math.min(dailyCalls - day.calls, SWEEP_DAILY_CALLS - used - reserve)
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM price_sweeps WHERE key LIKE '${ONEPIECE_KEY_PREFIX}%'`)
      .get() as { n: number }
  ).n
  const limit = Math.min(
    ONEPIECE_SWEEP_BATCH,
    Math.ceil(total / ONEPIECE_SWEEP_DAYS) - day.sets,
    Math.floor(calls / ONEPIECE_SET_CALLS)
  )
  if (limit <= 0) return stopped
  const batch = db
    .prepare(
      `SELECT key, language FROM price_sweeps
       WHERE key LIKE '${ONEPIECE_KEY_PREFIX}%' AND (swept_at IS NULL OR swept_at < ?)
       ORDER BY owned DESC, swept_at, key LIMIT ?`
    )
    .all(dueBefore, limit) as { key: string; language: string }[]
  if (batch.length === 0) return stopped
  const { remaining } = await client.quota()
  if (remaining === null) return stopped
  if (remaining <= SWEEP_RESERVE + reserve + batch.length * ONEPIECE_SET_CALLS) return stopped

  let swept = 0
  let spent = 0
  let limited = false
  for (const { key, language } of batch) {
    const prefix = key.slice(ONEPIECE_KEY_PREFIX.length)
    let searched = false
    try {
      const result = await client.onePieceListings(prefix, language)
      searched = true
      spent += result.calls ?? 1
      assignOnePieceSweep(db, prefix, language, result, now)
      swept++
    } catch (e) {
      // A failed search may have spent some of its pages before failing: count the most it could.
      if (!searched) spent += ONEPIECE_SET_CALLS
      if (e instanceof SweepRateLimited) {
        limited = true
        break
      }
      console.error('One Piece sweep failed', key, language, e instanceof Error ? e.message : '')
      // As Pokémon: due again in about a day, so a failure can't hold the head of the queue.
      db.prepare('UPDATE price_sweeps SET swept_at = ? WHERE key = ? AND language = ?').run(
        new Date(now.getTime() - 6 * DAY_MS).toISOString(),
        key,
        language
      )
    }
  }
  // A rate limit stops only this sweep for the day.
  setMeta(db, DAY_META, `${today}:${limited ? dailyCalls : day.calls + spent}:${day.sets + swept}`)
  setMeta(db, 'sweep_calls_day', `${today}:${used + spent}`)
  return { swept, calls: spent }
}
