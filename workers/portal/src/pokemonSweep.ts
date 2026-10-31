import type { SqlDb } from '../../../src/main/db/sql'
import { getMeta, setMeta } from '../../../src/main/db/meta'
import { askingPrice, isSingleCard } from '../../ebay-prices/src/price.js'
import {
  DAY_MS,
  POKEMON_KEY_PREFIX,
  SET_MAX_CALLS,
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
 * The weekly eBay sweep of Chinese Pokémon sets. TCGplayer doesn't sell these cards, so eBay is their
 * only price. A wrong price is worse than none, and these listings are noisy, so a listing counts only
 * if its title names the set, one number, the card and the language; see `parseListing` and `nameOk`.
 * Each seller counts once, and a price needs three of them (`MIN_SELLERS`).
 *
 * Off unless POKEMON_SWEEP_DAILY_CALLS (wrangler.toml) is set. Budget: it shares SWEEP_DAILY_CALLS, and
 * takes only what Yu-Gi-Oh! can't need; see `runPokemonSweep`.
 *
 * Rows live in price_sweeps with `pkm:` keys, so no migration: the table has no game column, and the
 * Yu-Gi-Oh! sweep skips these keys.
 */

/** The languages swept. Traditional lists itself once its printings are in the catalog. */
export const POKEMON_SWEEP_LANGUAGES = ['zh-hans', 'zh-hant'] as const
/** A higher setting is a typo, not a plan. */
export const POKEMON_MAX_DAILY_CALLS = 200
/** Browse calls a set can cost (the price Worker's POKEMON_MAX_PAGES). */
export const POKEMON_SET_CALLS = 3
/** Sets per alarm. Alarms run at least every 6 hours, so 24 sets a day at the least. */
export const POKEMON_SWEEP_BATCH = 6
/** Days the queue is spread over: a week, less the day Yu-Gi-Oh!'s own sweep fills. */
export const POKEMON_SWEEP_DAYS = 6
/** Sellers a price needs. Each counts once, so a dealer's many copies are one opinion. */
export const MIN_SELLERS = 3

const LISTED_META = 'price_sweeps_pkm_listed_at'
const DAY_META = 'sweep_pokemon_day'

/** The setting's value: a whole number of calls, or 0 (off) for anything else. */
export function pokemonDailyCalls(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? Math.min(n, POKEMON_MAX_DAILY_CALLS) : 0
}

/** "30thC 114/103" -> "30thC". */
export const pokemonSetOf = (setCode: string): string => setCode.split(' ')[0]

/** The printed number without zeros or count: "30thC 014/103" -> "14". Null for letter numbers. */
export function pokemonNumberOf(setCode: string): string | null {
  const m = /^\S+ 0*(\d+)(?:\/\d+)?$/.exec(setCode)
  return m ? m[1] : null
}

/**
 * How sellers write a set: the code, and for Simplified also without the catalog's trailing C
 * ("cs3a", "CS4B"). Not when that leaves no digit or a leading one: "30th" and "151" are other things.
 */
export function pokemonCodes(set: string, language: string): string[] {
  if (language !== 'zh-hans' || !/^[A-Za-z].*\d.*C$/.test(set)) return [set]
  return [set, set.slice(0, -1)]
}

/** Too short to find in a title: "MP" also means Moderately Played. */
const searchable = (set: string): boolean => set.length >= 4

const regexEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A set code as a whole token: "CS2" is not in "CS2a" or "CS2.5", though it may end a sentence.
const BEFORE_CODE = '(?<![A-Za-z0-9.])'
const AFTER_CODE = '(?![A-Za-z0-9])(?!\\.\\d)'
/** Any set code of the Chinese lists, to catch a title naming another set. */
const ANY_SET_CODE = new RegExp(
  `${BEFORE_CODE}(?:CS[VM]?[A-Z]?\\d[A-Za-z0-9.]*|CBB\\d[A-Za-z]*|30thD?C|151C)${AFTER_CODE}`,
  'gi'
)

const SIMPLIFIED = /\b(?:s[-. ]?)?chinese\b|\bsimplified\b|简体|简中/i
const TRADITIONAL = /\btraditional\b|\bt[-. ]?chinese\b|繁[體体]/i
const NAMES_SIMPLIFIED = /\bsimplified\b|\bs[-. ]?chinese\b|简体|简中/i
const OTHER_LANGUAGE =
  /\bjapan(?:ese)?\b|\bjpn?\b|\bkorean\b|\benglish\b|\beng?\b|\bthai\b|\bindonesian\b|日文|日本|韩文|韓文/i
const OTHER_REGION = /\btaiwan\b|\bhong\s*kong\b/i

/** True when the title says the card is in `language` and in no other. */
export function languageOk(title: string, language: string): boolean {
  if (OTHER_LANGUAGE.test(title)) return false
  if (language === 'zh-hans')
    return SIMPLIFIED.test(title) && !TRADITIONAL.test(title) && !OTHER_REGION.test(title)
  return TRADITIONAL.test(title) && !NAMES_SIMPLIFIED.test(title)
}

/** The grading houses of these listings, which isSingleCard doesn't know or misses as "PSA10". */
const SLAB =
  /\b(?:psa|bgs|cgc|sgc|ccic|pcg|wcg|ags|hga|gma|ars)\s*\d|\b(?:ccic|pcg|wcg|ags|hga|gma)\b|\b(?:ace|tag)\s+\d|\bgem\s*(?:mt|mint)\b|\bpristine\b|\bgraded?\b|\bgrade\s*\d/i
const SEVERAL =
  /\b\d+\s*pcs?\b|\b\d+\s*cards\b|[&＆+]\s*\d|[&＆+]\s*(?:rev(?:erse)?|holo)\b|\b(?:complete|master|full)\s+set\b|\b(?:pick|choose|select)\b|\byour\s+choice\b/i
const NOT_A_CARD = /\b(?:booster|sealed|box|tin|etb|sticker|coins?|sleeves?|playmat|binder|non[- ]?tcg)\b/i
const FAKE = /\b(?:reprint|replica|fake|unofficial|handmade|fan\s*art)\b/i
const BAD_CONDITION = /\b(?:damaged|dmg|creased?|heavily\s+played)\b/i
const OTHER_PRINTING =
  /\b(?:1st\s*ed(?:ition)?|first\s+edition|promos?|stamp(?:ed)?|errors?|misprints?|miscut|staff|pre-?release|jumbo|oversized?|metal\s+card|gold(?:en)?)\b/i

const EXPANSION_STAMP = /\bexpansion\s+stamp\b|\bset\s+logo\b|\blogo\s+(?:stamp|holo)\b/i

/** Finishes a title can name, each spelled as sellers spell it. */
const FINISHES: readonly (readonly [Finish, RegExp])[] = [
  ['master', /\bmaster\s*ball\b|大师球/i],
  ['ball', /\bpok[eé]\s*-?\s*ball\b|(?<!master\s*)\bball\s+(?:pattern|mirror|foil|holo)\b|精灵球|球闪/i],
  ['reverse', /\brev(?:erse)?\b|\bmirror\b|镜闪|镜面/i],
  ['starlight', /\bstarlight\b|星光/i],
  ['logo', EXPANSION_STAMP]
]
const HOLO = /\bholo(?:foil|graphic)?\b|\bfoil\b/i

export type Finish = 'plain' | 'holo' | 'master' | 'ball' | 'reverse' | 'starlight' | 'logo'

/** The finish a title names, 'plain' for none, or null when it names two. */
export function listingFinish(title: string): Finish | null {
  let named = FINISHES.filter(([, re]) => re.test(title)).map(([f]) => f)
  // A ball pattern is a mirror: "Pokeball Mirror" names one finish.
  if (named.includes('ball') || named.includes('master')) named = named.filter((f) => f !== 'reverse')
  if (named.length > 1) return null
  return named[0] ?? (HOLO.test(title) ? 'holo' : 'plain')
}

/** The titles' finishes each version takes. Normal's listings say nothing, so "holo" isn't one. */
const VERSION_FINISHES: Record<string, Finish[]> = {
  Normal: ['plain'],
  Holofoil: ['plain', 'holo'],
  'Reverse Holofoil': ['reverse'],
  'Poke Ball Pattern': ['ball'],
  'Master Ball Pattern': ['master'],
  'Starlight Holo': ['starlight'],
  'Set Logo Holofoil': ['logo']
}

/** Every number the title gives this card: "012/129", "#012", or right after the set code. */
function titleNumbers(title: string, codes: RegExp): Set<string> {
  const out = new Set<string>()
  const add = (n: string): void => void out.add(n.replace(/^0+(?=\d)/, ''))
  for (const m of title.matchAll(/(?<![\d/.])(\d{1,4})\s*\/\s*\d{2,4}(?![\d/])/g)) add(m[1])
  for (const m of title.matchAll(/#\s*(\d{1,4})(?![\d/])/g)) add(m[1])
  const adjacent = new RegExp(`(?:${codes.source})[-\\s]\\s*#?(\\d{2,4})(?![\\d/.])`, 'gi')
  for (const m of title.matchAll(adjacent)) if (!/^(?:19|20)\d\d$/.test(m[1])) add(m[1])
  return out
}

export interface ParsedListing {
  number: string
  finish: Finish
}

/**
 * What one title is a listing of, or null unless it is plainly one raw card of the set in `language`,
 * with one number and at most one finish. A title naming no set code is dropped however good it
 * looks: "Arbok 208/204 AR Chinese" could be any set of that size.
 */
export function parseListing(title: string, codes: string[], language: string): ParsedListing | null {
  if (!languageOk(title, language) || !isSingleCard(title)) return null
  if ([SLAB, SEVERAL, NOT_A_CARD, FAKE, BAD_CONDITION].some((re) => re.test(title))) return null
  if (OTHER_PRINTING.test(title.replace(EXPANSION_STAMP, ' '))) return null

  const own = new Set(codes.map((c) => c.toLowerCase()))
  const found = [...title.matchAll(ANY_SET_CODE)].map((m) => m[0].replace(/\.$/, '').toLowerCase())
  if (found.some((c) => !own.has(c))) return null
  const codeRe = new RegExp(`${BEFORE_CODE}(?:${codes.map(regexEscape).join('|')})${AFTER_CODE}`, 'i')
  if (!codeRe.test(title)) return null

  const numbers = titleNumbers(title, new RegExp(`(?:${codes.map(regexEscape).join('|')})`, 'i'))
  if (numbers.size !== 1) return null
  const finish = listingFinish(title)
  return finish ? { number: [...numbers][0], finish } : null
}

/** Name tags sellers drop or spell their own way; the species decides. */
const NAME_TAGS = new Set(['ex', 'gx', 'v', 'vmax', 'vstar', 'vunion', 'break', 'lvx', 'lv', 'x'])

const words = (s: string): string[] =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** True when the title names the card, in English or Chinese; a card we can't name never matches. */
export function nameOk(title: string, name: string, localName: string | null, set: string): boolean {
  if (localName) {
    const bare = localName.replace(/\s*(?:ex|EX|GX|V|VMAX|VSTAR|LV\.X)$/, '').trim()
    if (bare && title.includes(bare)) return true
  }
  // Nameless cards are called "CSV5C 012" in the catalog.
  if (name.startsWith(`${set} `)) return false
  const wanted = words(name).filter((w) => !NAME_TAGS.has(w))
  if (wanted.length === 0) return false
  const have = new Set(words(title))
  return wanted.every((w) => have.has(w))
}

export interface SetPrinting {
  id: number
  code: string
  version: string
  name: string
  localName: string | null
}

/**
 * The prices one set's listings support, by printing id. A listing joins a card only by set, number
 * and name, and a version only by finish. Where a card's versions can't be told apart by what a title
 * says (a plain title on a card with both Normal and Holofoil), that finish goes uncounted.
 */
export function pokemonSetPrices(
  items: PokemonListing[],
  printings: SetPrinting[],
  set: string,
  language: string
): Map<number, { price: number; listingCount: number }> {
  const codes = pokemonCodes(set, language)
  const byNumber = new Map<string, SetPrinting[]>()
  for (const p of printings) {
    const n = pokemonNumberOf(p.code)
    if (n !== null) byNumber.set(n, [...(byNumber.get(n) ?? []), p])
  }
  // number -> finish -> seller -> their cheapest copy
  const seen = new Map<string, Map<Finish, Map<string, number>>>()
  for (const item of items) {
    if (!item.seller || !Number.isFinite(item.price)) continue
    const parsed = parseListing(item.title, codes, language)
    if (!parsed) continue
    const card = byNumber.get(parsed.number)?.[0]
    if (!card || !nameOk(item.title, card.name, card.localName, set)) continue
    let finishes = seen.get(parsed.number)
    if (!finishes) seen.set(parsed.number, (finishes = new Map()))
    let sellers = finishes.get(parsed.finish)
    if (!sellers) finishes.set(parsed.finish, (sellers = new Map()))
    sellers.set(item.seller, Math.min(sellers.get(item.seller) ?? Infinity, item.price))
  }

  const out = new Map<number, { price: number; listingCount: number }>()
  for (const [number, finishes] of seen) {
    const versions = byNumber.get(number) ?? []
    const labels = new Set(versions.map((v) => v.version))
    for (const v of versions) {
      let wanted = VERSION_FINISHES[v.version] ?? []
      // Both exist, so a title with no finish could be either.
      if (labels.has('Normal') && labels.has('Holofoil'))
        wanted = wanted.filter((f) => f !== 'plain')
      const bySeller = new Map<string, number>()
      for (const f of wanted) {
        for (const [seller, price] of finishes.get(f) ?? [])
          bySeller.set(seller, Math.min(bySeller.get(seller) ?? Infinity, price))
      }
      const { price, listingCount } = askingPrice([...bySeller.values()])
      if (price !== null && listingCount >= MIN_SELLERS) out.set(v.id, { price, listingCount })
    }
  }
  return out
}

/**
 * Lists every Chinese Pokémon set with a searchable code, at most once a UTC day. As with Yu-Gi-Oh!,
 * `owned` marks a set with a live collection entry and `released` is its date; swept_at is never touched.
 */
export function refreshPokemonQueue(db: SqlDb, now: Date): number {
  const today = utcDay(now)
  if (getMeta(db, LISTED_META) === today) return 0
  const codes = db.prepare(
    `SELECT set_name, set_code,
       EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = p.id AND e.deleted_at IS NULL) AS owned
     FROM card_printings p WHERE language = ? AND +game = 'pkm' AND contributed = 0`
  )
  const dates = db.prepare(
    "SELECT set_name, MAX(tcg_date) AS d FROM sets WHERE language = ? AND game = 'pkm' GROUP BY set_name"
  )
  const upsert = db.prepare(
    `INSERT INTO price_sweeps (key, language, owned, released) VALUES (?, ?, ?, ?)
     ON CONFLICT(key, language) DO UPDATE SET owned = excluded.owned, released = excluded.released
     WHERE price_sweeps.owned IS NOT excluded.owned OR price_sweeps.released IS NOT excluded.released`
  )
  let n = 0
  db.transaction(() => {
    for (const language of POKEMON_SWEEP_LANGUAGES) {
      const released = new Map<string, string>()
      for (const r of dates.all(language) as { set_name: string; d: string | null }[])
        if (r.d) released.set(r.set_name, r.d)
      const sets = new Map<string, { owned: boolean; released: string | null }>()
      for (const r of codes.all(language) as { set_name: string; set_code: string; owned: number }[]) {
        const set = pokemonSetOf(r.set_code)
        if (!searchable(set)) continue
        const row = sets.get(set) ?? { owned: false, released: released.get(r.set_name) ?? null }
        row.owned ||= r.owned === 1
        sets.set(set, row)
      }
      for (const [set, row] of sets) {
        upsert.run(`${POKEMON_KEY_PREFIX}${set}`, language, row.owned ? 1 : 0, row.released)
        n++
      }
    }
    setMeta(db, LISTED_META, today)
  })()
  return n
}

/** A set's unpriced-by-market printings. The plus signs keep the planner on the set-code index. */
export const POKEMON_PRINTINGS_SQL = `SELECT p.id AS id, p.set_code AS code, p.set_rarity AS version, c.name AS name,
    pc.local_name AS localName
  FROM card_printings p JOIN cards c ON c.id = p.card_id AND +c.game = 'pkm'
  LEFT JOIN pokemon_cards pc ON pc.card_id = p.card_id
  WHERE +p.language = ? AND +p.game = 'pkm' AND p.set_code LIKE ? AND +p.contributed = 0
    AND +p.missing_from_api = 0 AND p.market_price IS NULL`

/** Writes one set's result. Never erases: a card with no good listings this week keeps its last price. */
export function assignPokemonSweep(
  db: SqlDb,
  set: string,
  language: string,
  result: PokemonListings,
  now: Date
): { priced: number } {
  const printings = db.prepare(POKEMON_PRINTINGS_SQL).all(language, `${set} %`) as SetPrinting[]
  const prices = pokemonSetPrices(result.items, printings, set, language)
  const checkedAt = result.checkedAt ?? now.toISOString()
  const upsert = db.prepare(
    `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(printing_id) DO UPDATE SET price = excluded.price,
       listing_count = excluded.listing_count, checked_at = excluded.checked_at`
  )
  db.transaction(() => {
    for (const [id, p] of prices) upsert.run(id, p.price, p.listingCount, checkedAt)
    db.prepare('UPDATE price_sweeps SET swept_at = ?, calls = calls + ? WHERE key = ? AND language = ?').run(
      now.toISOString(),
      result.calls ?? 1,
      `${POKEMON_KEY_PREFIX}${set}`,
      language
    )
  })()
  return { priced: prices.size }
}

function readDay(db: SqlDb, today: string): { calls: number; sets: number } {
  const [day, calls, sets] = (getMeta(db, DAY_META) ?? '').split(':')
  return day === today ? { calls: Number(calls) || 0, sets: Number(sets) || 0 } : { calls: 0, sets: 0 }
}

const NOT_POKEMON = `key NOT LIKE '${POKEMON_KEY_PREFIX}%'`

/**
 * What Yu-Gi-Oh!'s sweep could still spend today, at its dearest: every prefix that comes due before
 * the UTC day ends, at SET_MAX_CALLS each. Taking none of this is what keeps its sweep unchanged.
 */
function yugiohReserve(db: SqlDb, now: Date): number {
  const dayEnd = new Date(`${utcDay(now)}T00:00:00.000Z`).getTime() + DAY_MS
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM price_sweeps WHERE ${NOT_POKEMON} AND (swept_at IS NULL OR swept_at < ?)`)
    .get(new Date(dayEnd - WEEK_MS).toISOString()) as { n: number }
  return row.n * SET_MAX_CALLS
}

/**
 * One alarm's Pokémon sweep. Runs only if `dailyCalls` is on and no Yu-Gi-Oh! prefix is due, spends
 * only calls left after yugiohReserve, and stands down if the eBay quota is unknown or close enough to
 * the reserve that its calls could stop Yu-Gi-Oh!'s sweep early. Its calls count on the shared day. The
 * queue is spread over POKEMON_SWEEP_DAYS, by sets a day. Returns sets swept and calls spent.
 */
export async function runPokemonSweep(
  db: SqlDb,
  client: SweepClient | null,
  now: Date,
  dailyCalls: number
): Promise<{ swept: number; calls: number }> {
  const stopped = { swept: 0, calls: 0 }
  if (!client || dailyCalls <= 0) return stopped
  refreshPokemonQueue(db, now)
  const today = utcDay(now)
  const dueBefore = new Date(now.getTime() - WEEK_MS).toISOString()
  const yugiohDue = db
    .prepare(`SELECT 1 FROM price_sweeps WHERE ${NOT_POKEMON} AND (swept_at IS NULL OR swept_at < ?) LIMIT 1`)
    .get(dueBefore)
  if (yugiohDue) return stopped

  const day = readDay(db, today)
  const used = readCalls(db, today)
  const reserve = yugiohReserve(db, now)
  const calls = Math.min(dailyCalls - day.calls, SWEEP_DAILY_CALLS - used - reserve)
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM price_sweeps WHERE key LIKE '${POKEMON_KEY_PREFIX}%'`)
      .get() as { n: number }
  ).n
  const limit = Math.min(
    POKEMON_SWEEP_BATCH,
    Math.ceil(total / POKEMON_SWEEP_DAYS) - day.sets,
    Math.floor(calls / POKEMON_SET_CALLS)
  )
  if (limit <= 0) return stopped
  const batch = db
    .prepare(
      `SELECT key, language FROM price_sweeps
       WHERE key LIKE '${POKEMON_KEY_PREFIX}%' AND (swept_at IS NULL OR swept_at < ?)
       ORDER BY owned DESC, swept_at, released DESC LIMIT ?`
    )
    .all(dueBefore, limit) as { key: string; language: string }[]
  if (batch.length === 0) return stopped
  const { remaining } = await client.quota()
  if (remaining === null) return stopped
  if (remaining <= SWEEP_RESERVE + reserve + batch.length * POKEMON_SET_CALLS) return stopped

  let swept = 0
  let spent = 0
  let limited = false
  for (const { key, language } of batch) {
    const set = key.slice(POKEMON_KEY_PREFIX.length)
    let searched = false
    try {
      const result = await client.pokemonListings(pokemonCodes(set, language), language)
      searched = true
      spent += result.calls ?? 1
      assignPokemonSweep(db, set, language, result, now)
      swept++
    } catch (e) {
      if (e instanceof SweepRateLimited) {
        limited = true
        break
      }
      console.error('Pokémon sweep failed', key, language, e instanceof Error ? e.message : '')
      if (!searched) spent += 1
      // As Yu-Gi-Oh!: due again in about a day, so a failure can't hold the head of the queue.
      db.prepare('UPDATE price_sweeps SET swept_at = ? WHERE key = ? AND language = ?').run(
        new Date(now.getTime() - 6 * DAY_MS).toISOString(),
        key,
        language
      )
    }
  }
  // A rate limit stops only this sweep for the day; Yu-Gi-Oh!'s finds its own 429.
  setMeta(db, DAY_META, `${today}:${limited ? dailyCalls : day.calls + spent}:${day.sets + swept}`)
  setMeta(db, 'sweep_calls_day', `${today}:${used + spent}`)
  return { swept, calls: spent }
}
