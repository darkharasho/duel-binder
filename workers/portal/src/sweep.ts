import type { SqlDb } from '../../../src/main/db/sql'
import { getMeta, setMeta } from '../../../src/main/db/meta'
import { sweepKey } from '../../../src/shared/prices/sweepKey'
import type { PriceEnv } from './prices'

/** eBay Browse calls the sweep may spend per UTC day. */
export const SWEEP_DAILY_CALLS = 2000
/** Browse calls left for the day at which the sweep stands down (the per-card lookups need them). */
export const SWEEP_RESERVE = 2000
/** Prefixes swept per alarm run. */
export const SWEEP_BATCH = 10
/** The Asian languages the sweep covers; the same values the price Worker's /v1/set accepts. */
export const SWEEP_LANGUAGES = ['ja', 'ko', 'zh-hans', 'zh-hant', 'ae'] as const

/** Most Browse calls one Yu-Gi-Oh! prefix can cost (the price Worker's SET_MAX_PAGES). */
export const SET_MAX_CALLS = 5
/** Pokémon rows in price_sweeps have keys with this prefix; see pokemonSweep.ts. */
export const POKEMON_KEY_PREFIX = 'pkm:'

export const DAY_MS = 24 * 3600 * 1000
export const WEEK_MS = 7 * DAY_MS
const TIMEOUT_MS = 60_000

export interface SetEntry {
  price: number | null
  listingCount: number
}

/** The price Worker's /v1/set body. */
export interface SetResult {
  codes: Record<string, { all: SetEntry; byRarity: Record<string, SetEntry> }>
  calls?: number
  checkedAt?: string
}

/** One listing of the price Worker's /v1/pokemon-listings: USD, fixed price, not graded. */
export interface PokemonListing {
  title: string
  price: number
  seller: string
}

/** The price Worker's /v1/pokemon-listings body. */
export interface PokemonListings {
  items: PokemonListing[]
  calls?: number
  checkedAt?: string
}

export interface SweepClient {
  set(key: string, lang: string): Promise<SetResult>
  pokemonListings(codes: string[], lang: string): Promise<PokemonListings>
  quota(): Promise<{ remaining: number | null }>
}

/** eBay (or the price Worker) said slow down. */
export class SweepRateLimited extends Error {
  constructor() {
    super('Set sweep rate limited')
    this.name = 'SweepRateLimited'
  }
}

/** Like priceClientFor: null without PRICE_WORKER_URL, and through the PRICES binding when present. */
export function sweepClientFor(env: PriceEnv): SweepClient | null {
  if (!env.PRICE_WORKER_URL) return null
  const base = env.PRICE_WORKER_URL.replace(/\/+$/, '')
  const binding = env.PRICES
  const fetchFn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    binding ? binding.fetch(input, init) : fetch(input, init)
  const get = async (path: string): Promise<Response> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      return await fetchFn(`${base}${path}`, {
        headers: { 'X-Client': 'duel-binder' },
        signal: ctrl.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    async set(key, lang) {
      const res = await get(`/v1/set?${new URLSearchParams({ key, lang })}`)
      if (res.status === 429) throw new SweepRateLimited()
      if (res.status !== 200) throw new Error(`Set sweep returned ${res.status}`)
      const body = (await res.json()) as Partial<SetResult> | null
      if (!body || typeof body.codes !== 'object' || body.codes === null)
        throw new Error('Set sweep returned an unexpected response')
      return body as SetResult
    },
    async pokemonListings(codes, lang) {
      const res = await get(
        `/v1/pokemon-listings?${new URLSearchParams({ codes: codes.join(','), lang })}`
      )
      if (res.status === 429) throw new SweepRateLimited()
      if (res.status !== 200) throw new Error(`Pokémon sweep returned ${res.status}`)
      const body = (await res.json()) as Partial<PokemonListings> | null
      if (!body || !Array.isArray(body.items))
        throw new Error('Pokémon sweep returned an unexpected response')
      return body as PokemonListings
    },
    async quota() {
      try {
        const res = await get('/v1/quota')
        if (res.status !== 200) return { remaining: null }
        const body = (await res.json()) as { remaining?: unknown } | null
        const n = body?.remaining
        return { remaining: typeof n === 'number' && Number.isFinite(n) ? n : null }
      } catch {
        return { remaining: null }
      }
    }
  }
}

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10)

/**
 * Lists every Asian (sweepKey, language) prefix of Yu-Gi-Oh! printings (the eBay sweep is Yu-Gi-Oh!
 * only), at most once a UTC day. `owned` marks prefixes with a live collection entry; `released` is the latest set date. Never touches swept_at.
 * One query per language per table (DO SQLite rejects long compound queries). Returns rows upserted.
 */
export function refreshSweepQueue(db: SqlDb, now: Date): number {
  const today = utcDay(now)
  if (getMeta(db, 'price_sweeps_listed_at') === today) return 0
  const codes = db.prepare(
    `SELECT set_name, set_code,
       MAX(EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = p.id AND e.deleted_at IS NULL)) AS owned
     FROM card_printings p WHERE language = ? AND game = 'ygo' GROUP BY set_name, set_code`
  )
  const dates = db.prepare(
    "SELECT set_name, MAX(tcg_date) AS d FROM sets WHERE language = ? AND game = 'ygo' GROUP BY set_name"
  )
  const upsert = db.prepare(
    `INSERT INTO price_sweeps (key, language, owned, released) VALUES (?, ?, ?, ?)
     ON CONFLICT(key, language) DO UPDATE SET owned = excluded.owned, released = excluded.released
     WHERE price_sweeps.owned IS NOT excluded.owned OR price_sweeps.released IS NOT excluded.released`
  )
  let n = 0
  db.transaction(() => {
    for (const language of SWEEP_LANGUAGES) {
      const released = new Map<string, string>()
      for (const r of dates.all(language) as { set_name: string; d: string | null }[])
        if (r.d) released.set(r.set_name, r.d)
      const ownedKeys = new Set<string>()
      const keys = new Map<string, string | null>()
      for (const r of codes.all(language) as {
        set_name: string
        set_code: string
        owned: number
      }[]) {
        const key = sweepKey(r.set_code).toUpperCase()
        if (!key) continue
        if (r.owned) ownedKeys.add(key)
        const d = released.get(r.set_name) ?? null
        const prev = keys.get(key) ?? null
        keys.set(key, d !== null && (prev === null || d > prev) ? d : prev)
      }
      for (const [key, d] of keys) {
        upsert.run(key, language, ownedKeys.has(key) ? 1 : 0, d)
        n++
      }
    }
    setMeta(db, 'price_sweeps_listed_at', today)
  })()
  return n
}

/**
 * A prefix's Yu-Gi-Oh! printings. The unary pluses keep the planner off idx_printings_lang_set and the
 * game indexes (which, with no ANALYZE stats, read the whole language or game) and on the NOCASE
 * set-code index that LIKE can use.
 */
export const ASSIGN_PRINTINGS_SQL = `SELECT p.id AS id, p.set_code AS code, p.set_rarity AS rarity, ip.checked_at AS checkedAt,
    ip.price AS price
  FROM card_printings p LEFT JOIN intl_prices ip ON ip.printing_id = p.id
  WHERE +p.language = ? AND +p.game = 'ygo' AND p.set_code LIKE ?`

/**
 * Writes a prefix's sweep result onto its printings. A one-printing code takes its rarity price when
 * that has 2+ listings (`all` runs high when other variants leak in), else `all`; a code with several
 * printings takes only the price named for its rarity. Thin or missing prices are not written, and a
 * priced row checked since the previous sweep (a per-card price) is left alone; a per-card "nothing
 * found" row is filled. Never deletes.
 */
export function assignSweep(
  db: SqlDb,
  key: string,
  language: string,
  result: SetResult,
  now: Date
): { priced: number; skipped: number } {
  const state = db
    .prepare('SELECT swept_at FROM price_sweeps WHERE key = ? AND language = ?')
    .get(key, language) as { swept_at: string | null } | undefined
  // Never swept: any per-card price from the past week still beats a set-wide guess.
  const fresherThan = state?.swept_at ?? new Date(now.getTime() - WEEK_MS).toISOString()
  const checkedAt = result.checkedAt ?? now.toISOString()
  const rows = (
    db.prepare(ASSIGN_PRINTINGS_SQL).all(language, `${key}%`) as {
      id: number
      code: string
      rarity: string
      checkedAt: string | null
      price: number | null
    }[]
  ).filter((r) => sweepKey(r.code).toUpperCase() === key.toUpperCase())

  const perCode = new Map<string, number>()
  for (const r of rows)
    perCode.set(r.code.toUpperCase(), (perCode.get(r.code.toUpperCase()) ?? 0) + 1)

  const upsert = db.prepare(
    `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(printing_id) DO UPDATE SET price = excluded.price,
       listing_count = excluded.listing_count, checked_at = excluded.checked_at`
  )
  const usable = (e: SetEntry | undefined): e is SetEntry =>
    !!e && e.price !== null && Number.isFinite(e.price) && e.listingCount >= 2
  let priced = 0
  let skipped = 0
  db.transaction(() => {
    for (const r of rows) {
      const code = result.codes[r.code.toUpperCase()]
      const byRarity =
        code && Object.hasOwn(code.byRarity ?? {}, r.rarity) ? code.byRarity[r.rarity] : undefined
      let entry: SetEntry | undefined
      if (code) {
        if (perCode.get(r.code.toUpperCase()) === 1) entry = usable(byRarity) ? byRarity : code.all
        else entry = byRarity
      }
      if (
        !usable(entry) ||
        (r.price !== null && r.checkedAt !== null && r.checkedAt > fresherThan)
      ) {
        skipped++
        continue
      }
      upsert.run(r.id, entry.price, entry.listingCount, checkedAt)
      priced++
    }
    // swept_at is never before the result's own timestamp, or the rows just written would read as
    // fresher per-card prices at the next sweep.
    const sweptAt = checkedAt > now.toISOString() ? checkedAt : now.toISOString()
    db.prepare(
      'UPDATE price_sweeps SET swept_at = ?, calls = calls + ? WHERE key = ? AND language = ?'
    ).run(sweptAt, result.calls ?? 1, key, language)
  })()
  return { priced, skipped }
}

/** Today's eBay sweep calls from meta; 0 when the stored count is for another UTC day. */
export function readCalls(db: SqlDb, today: string): number {
  const v = getMeta(db, 'sweep_calls_day')
  if (!v) return 0
  const [day, n] = v.split(':')
  return day === today ? Number(n) || 0 : 0
}

/**
 * One alarm's worth of sweeping: up to SWEEP_BATCH due prefixes (never swept, or swept over a week
 * ago; owned and newest first), one eBay set search each. Stops at the day's call cap, when the eBay
 * quota is down to the reserve, or on a rate limit. `more` means due prefixes and budget remain.
 */
export async function runSweep(
  db: SqlDb,
  client: SweepClient | null,
  now: Date
): Promise<{ swept: number; calls: number; more: boolean }> {
  const stopped = { swept: 0, calls: 0, more: false }
  if (!client) return stopped
  const today = utcDay(now)
  let used = readCalls(db, today)
  if (used >= SWEEP_DAILY_CALLS) return stopped
  const dueBefore = new Date(now.getTime() - WEEK_MS).toISOString()
  const due = (limit: number): { key: string; language: string }[] =>
    db
      .prepare(
        `SELECT key, language FROM price_sweeps WHERE key NOT LIKE '${POKEMON_KEY_PREFIX}%' AND (swept_at IS NULL OR swept_at < ?)
         ORDER BY owned DESC, swept_at, released DESC LIMIT ?`
      )
      .all(dueBefore, limit) as { key: string; language: string }[]
  const batch = due(SWEEP_BATCH)
  if (batch.length === 0) return stopped
  try {
    const { remaining } = await client.quota()
    if (remaining !== null && remaining <= SWEEP_RESERVE) return stopped
  } catch {
    // An unreadable quota is not a reason to stand down; the daily cap still holds.
  }

  let swept = 0
  let calls = 0
  let limited = false
  for (const { key, language } of batch) {
    if (used >= SWEEP_DAILY_CALLS) break
    let searched = false
    try {
      const result = await client.set(key, language)
      searched = true
      // Spent as soon as the search returned, even if writing it fails.
      const spent = result.calls ?? 1
      used += spent
      calls += spent
      assignSweep(db, key, language, result, now)
      swept++
    } catch (e) {
      if (e instanceof SweepRateLimited) {
        used = SWEEP_DAILY_CALLS
        limited = true
        break
      }
      console.error('Set sweep failed', key, language, e instanceof Error ? e.message : '')
      // A failed search may still have spent a Browse call; count one (already counted if it returned).
      if (!searched) used += 1
      // Back off: due again in about a day, so a permanent failure can't hold the head of the queue.
      db.prepare('UPDATE price_sweeps SET swept_at = ? WHERE key = ? AND language = ?').run(
        new Date(now.getTime() - 6 * DAY_MS).toISOString(),
        key,
        language
      )
    }
  }
  setMeta(db, 'sweep_calls_day', `${today}:${used}`)
  const more = !limited && used < SWEEP_DAILY_CALLS && due(1).length > 0
  return { swept, calls, more }
}
