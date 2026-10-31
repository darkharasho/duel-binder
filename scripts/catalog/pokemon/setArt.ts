import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getMeta, setMeta } from '../../../src/main/db/meta'
import {
  BULBAGARDEN_IMAGE_PREFIX,
  isFallbackLogoUrl,
  POKEMONTCG_IMAGE_PREFIX,
  SCRYDEX_IMAGE_PREFIX
} from '../../../src/shared/imageSources'
import { REPO_URL } from './http'
import type { TdLang } from './types'
import { setImageKey } from './write'

/**
 * Pokémon set art for the nightly job, written to `pokemon_set_art`:
 *
 * - Booster pack images from the Bulbagarden Archives (a MediaWiki), found through its pack
 *   categories with the API and matched to our sets by Bulbapedia's set code or the set's name. Every
 *   design a set has is kept (sort_order 0, the largest image, is the main one the app shows).
 * - Set logos from the Pokémon TCG API, for English sets TCGdex has no logo for (TCGdex's own logo
 *   stays in `sets.image_url`), plus a few picked by hand (HAND_PICKED_LOGOS). Neither source has
 *   Japanese logos.
 *
 * Only URLs are stored here. The portal mirrors each image into R2 the first time it's asked for,
 * and the job asks for new ones itself, one a second (see warmSetArt), so clients never reach
 * Bulbagarden. Bulbagarden's images are © The Pokémon Company; the app credits Bulbagarden.
 */

export const BULBAGARDEN_API = 'https://archives.bulbagarden.net/w/api.php'
export const POKEMONTCG_SETS_URL =
  'https://api.pokemontcg.io/v2/sets?pageSize=250&select=id,name,ptcgoCode,images'
export const SET_ART_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
/** Bulbagarden asks API clients to go slowly: at most one request a second. */
export const BULBAGARDEN_GAP_MS = 1100
const TIMEOUT_MS = 30_000
const MAX_PAGES = 40

/** The category trees each language's packs are filed under ('flat': files only, no subcategories). */
const CATEGORIES: { lang: TdLang; title: string; flat?: true }[] = [
  { lang: 'en', title: 'Category:English TCG packs' },
  { lang: 'ja', title: 'Category:Japanese TCG packs' },
  // Most Japanese packs sit in the parent category, beside other languages' (filtered out below).
  { lang: 'ja', title: 'Category:TCG booster packs', flat: true }
]

export interface ArchiveFile {
  /** Without the "File:" prefix. */
  title: string
  url: string
  width: number
  height: number
}

export interface SetRow {
  set_name: string
  set_code: string
  image_key: string | null
  image_url: string | null
}

export interface SetArtReport {
  packs: Record<TdLang, { matched: number; sets: number; unmatchedSets: string[] }>
  logos: { matched: number; missing: number; unmatchedSets: string[] }
  /** Pack files that named no set we have, per language (for the dry run). */
  unmatchedFiles: Record<TdLang, string[]>
  problems: string[]
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Lowercase letters and digits only, accents dropped: "Pokémon Jungle" meets "Pokemon Jungle". */
export const nameKey = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** A set code compared loosely: "SM1Plus" meets "SM1+", "SV3a" meets "SV3A". */
export const codeKey = (s: string): string => nameKey(s.replace(/\+/g, 'plus'))

const sha = (url: string): string => createHash('sha1').update(url).digest('hex').slice(0, 20)

/** 'bp-' + first 20 hex chars of sha1(url); null for anything outside Bulbagarden's uploads. */
export function bulbagardenKey(url: string): string | null {
  return url.startsWith(BULBAGARDEN_IMAGE_PREFIX) ? `bp-${sha(url)}` : null
}

/** 'pt-' + first 20 hex chars of sha1(url); null for anything outside the Pokémon TCG API's images. */
export function pokemontcgKey(url: string): string | null {
  return isFallbackLogoUrl(url) ? `pt-${sha(url)}` : null
}

// ---- Reading the archive ----------------------------------------------------------------------

interface CategoryPage {
  continue?: Record<string, string>
  query?: {
    pages?: Record<
      string,
      { ns: number; title: string; imageinfo?: { url?: string; width?: number; height?: number }[] }
    >
  }
}

export interface ArchiveOpts {
  fetch: typeof fetch
  userAgent: string
  /** Waits between API requests; tests pass a no-op. */
  pause?: () => Promise<void>
  /** First retry backoff in ms (doubling); tests pass a tiny value. */
  retryDelayMs?: number
}

const ATTEMPTS = 4

/**
 * GET as JSON, retrying a network error, 429 or 5xx (both APIs answer those now and then) after
 * 2, 4 and 8 s; anything else, or the last failure, throws.
 */
async function getJsonRetrying<T>(
  fetchFn: typeof fetch,
  url: string,
  userAgent: string,
  retryDelayMs = 2000
): Promise<T> {
  let last = ''
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * 2 ** (attempt - 1))
    let res: Response
    try {
      res = await fetchFn(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
      continue
    }
    if (res.ok) return (await res.json()) as T
    last = `HTTP ${res.status}`
    if (res.status !== 429 && res.status < 500) break
  }
  throw new Error(last)
}

/**
 * Every file in a category tree with its original (largest) URL and size, one API request a
 * second. Subcategories are walked unless `flat`.
 */
export async function listCategoryFiles(
  root: string,
  opts: ArchiveOpts & { flat?: boolean }
): Promise<ArchiveFile[]> {
  const pause = opts.pause ?? (() => sleep(BULBAGARDEN_GAP_MS))
  const files = new Map<string, ArchiveFile>()
  const seen = new Set<string>()
  const todo = [root]
  let requests = 0
  while (todo.length > 0) {
    const category = todo.shift()!
    if (seen.has(category)) continue
    seen.add(category)
    let cont: Record<string, string> = {}
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'categorymembers',
        gcmtitle: category,
        gcmtype: opts.flat ? 'file' : 'file|subcat',
        gcmlimit: '500',
        prop: 'imageinfo',
        iiprop: 'url|size',
        ...cont
      })
      if (requests++ > 0) await pause()
      const body = await getJsonRetrying<CategoryPage>(
        opts.fetch,
        `${BULBAGARDEN_API}?${params}`,
        opts.userAgent,
        opts.retryDelayMs
      ).catch((e: Error) => {
        throw new Error(`Bulbagarden ${category}: ${e.message}`)
      })
      for (const p of Object.values(body.query?.pages ?? {})) {
        if (p.ns === 14) {
          if (!opts.flat) todo.push(p.title)
          continue
        }
        const info = p.imageinfo?.[0]
        if (p.ns !== 6 || !info?.url || !info.width || !info.height) continue
        files.set(p.title, {
          title: p.title.replace(/^File:/, ''),
          url: info.url,
          width: info.width,
          height: info.height
        })
      }
      if (!body.continue) break
      cont = body.continue
    }
  }
  return [...files.values()]
}

// ---- Matching ---------------------------------------------------------------------------------

/**
 * Bulbapedia's English set codes ("SWSH9", "HS2", "E1") as TCGdex ids ("swsh9", "hgss2",
 * "ecard1"). Scarlet & Violet and Mega Evolution ids are zero-padded ("sv01", "me02").
 */
const EN_SERIES: Record<string, { id: string; pad?: true }> = {
  BW: { id: 'bw' },
  DP: { id: 'dp' },
  PL: { id: 'pl' },
  HS: { id: 'hgss' },
  EX: { id: 'ex' },
  E: { id: 'ecard' },
  SM: { id: 'sm' },
  SWSH: { id: 'swsh' },
  XY: { id: 'xy' },
  SV: { id: 'sv', pad: true },
  ME: { id: 'me', pad: true }
}
const EN_CODE = /^(BW|DP|PL|HS|EX|E|SM|SWSH|XY|SV|ME)(\d+)(?:\.(\d+))?$/

/** English pack files named for a set we know under another name. */
const EN_NAME_ALIASES: Record<string, string> = { championpath: "Champion's Path" }

/**
 * Japanese pack files whose Bulbapedia code isn't the set's TCGdex code: sets released as a pair
 * under one code (XY1 Collection X and Y), and the ADV packs, which TCGdex numbers from the
 * Magma vs Aqua pack (Bulbapedia's "Ex1"). File name (before " pack") → set code.
 */
const JA_FILE_SETS: Record<string, string> = {
  'XY1 Collection X': 'XY1A',
  'XY1 Collection Y': 'XY1B',
  'XY5 Gaia Volcano': 'XY5A',
  'XY5 Tidal Storm': 'XY5B',
  'XY8 Blue Shock': 'XY8A',
  'XY8 Red Flash': 'XY8B',
  'XY11 Fever-Burst Fighter': 'XY11A',
  'XY11 Cruel Traitor': 'XY11B',
  'Ex1 Magma VS Aqua Two Ambitions': 'ADV4',
  'ADV4 Undone Seal': 'ADV5'
}

/** Not a pack front: its back ("… reverse"), a promo or campaign pack, or another language's print. */
const EN_SKIP = /\b(reverse|back)$/i
const JA_SKIP =
  /\b(Korean|Thai|Indonesian|Chinese|English|Booster|Promo|Campaign|Gym)\b|\b(reverse|back)$/i
/** Language tags: "… Booster ZH", "SV2a K pack" (Korean), "SV2D pack K". */
const JA_SKIP_TAGS = /\b(BR|DE|ES|FR|IT|KO|ZH|EN)\b|\b[FIKT] pack\b|\bpack [A-Z]$/

const stem = (title: string): string => title.replace(/\.[A-Za-z0-9]+$/, '')

/** A wrapper is tall; anything wider than this share of its height is a box, a display or a fan of packs. */
const MAX_ASPECT = 0.8

/**
 * The names a pack file might give its set: the words before each "Booster"/"pack" word, with and
 * without that word ("Poké Card Creator Pack front" → "Poké Card Creator", "Poké Card Creator
 * Pack"), longest first.
 */
function nameCandidates(words: string[]): string[] {
  const out: string[] = []
  words.forEach((w, i) => {
    if (i > 0 && /^(Booster|pack|Pack)$/.test(w)) {
      out.push(words.slice(0, i).join(' '), words.slice(0, i + 1).join(' '))
    }
  })
  return [...new Set(out)].sort((a, b) => b.length - a.length)
}

/** Our English set a pack file is for, or null. */
export function matchEnglishFile(
  file: ArchiveFile,
  byKey: Map<string, SetRow>,
  byName: Map<string, SetRow>
): SetRow | null {
  const name = stem(file.title)
  if (EN_SKIP.test(name)) return null
  const words = name.split(/\s+/)
  const code = EN_CODE.exec(words[0])
  if (code) {
    const series = EN_SERIES[code[1]]
    const n = series.pad ? code[2].padStart(2, '0') : code[2]
    let id = `${series.id}${n}${code[3] ? `.${code[3]}` : ''}`
    // "SV10.5 BLK Booster EN" and "… WHT …": Black Bolt and White Flare, sv10.5b and sv10.5w.
    if (code[3]) id += /\bBLK\b/.test(name) ? 'b' : /\bWHT\b/.test(name) ? 'w' : ''
    return byKey.get(setImageKey('en', id)) ?? null
  }
  for (const candidate of nameCandidates(words)) {
    const k = nameKey(candidate)
    const set = byName.get(k) ?? byName.get(nameKey(EN_NAME_ALIASES[k] ?? ''))
    if (set) return set
  }
  return null
}

/** Our Japanese set a pack file is for, or null. */
export function matchJapaneseFile(
  file: ArchiveFile,
  byCode: Map<string, SetRow>,
  byName: Map<string, SetRow>
): SetRow | null {
  const name = stem(file.title)
  if (JA_SKIP.test(name) || JA_SKIP_TAGS.test(name)) return null
  const words = name.split(/\s+/)
  // The last "pack" ends the name ("Expansion Pack pack").
  let end = -1
  words.forEach((w, i) => {
    if (i > 0 && /^(pack|Pack)$/.test(w)) end = i
  })
  if (end < 0) return null
  const ident = words.slice(0, end).join(' ')
  const fixed = JA_FILE_SETS[ident]
  if (fixed) return byCode.get(codeKey(fixed)) ?? null
  const first = words[0]
  const isCode = /\d/.test(first) ? /^[A-Za-z]+\d/.test(first) : /^[A-Z]{2,}$/.test(first)
  if (isCode) {
    const set = byCode.get(codeKey(first))
    if (set) return set
  }
  // Older packs, and a code shared by two sets ("SV11 Black Bolt"): by the English name.
  const named = isCode ? words.slice(1, end).join(' ') : ident
  return named ? (byName.get(nameKey(named)) ?? null) : null
}

/**
 * Each set's pack images (largest first), by set name. A set's files must be tall like a wrapper;
 * every one kept is a design the set came in.
 */
export function matchPacks(
  lang: TdLang,
  files: ArchiveFile[],
  sets: SetRow[]
): { art: Map<string, ArchiveFile[]>; unmatchedFiles: string[] } {
  const byKey = new Map(sets.flatMap((s) => (s.image_key ? [[s.image_key, s] as const] : [])))
  const byName = new Map(sets.map((s) => [nameKey(s.set_name), s]))
  const byCode = new Map(sets.map((s) => [codeKey(s.set_code), s]))
  const art = new Map<string, ArchiveFile[]>()
  const unmatchedFiles: string[] = []
  const urls = new Set<string>()
  for (const f of files) {
    if (f.width > f.height * MAX_ASPECT || urls.has(f.url)) continue
    if (!f.url.startsWith(BULBAGARDEN_IMAGE_PREFIX)) continue
    const set =
      lang === 'en' ? matchEnglishFile(f, byKey, byName) : matchJapaneseFile(f, byCode, byName)
    if (!set) {
      unmatchedFiles.push(f.title)
      continue
    }
    urls.add(f.url)
    const list = art.get(set.set_name) ?? []
    list.push(f)
    art.set(set.set_name, list)
  }
  for (const list of art.values()) {
    list.sort((a, b) => b.width * b.height - a.width * a.height || (a.title < b.title ? -1 : 1))
  }
  // A subset printed in another set's boosters ("Brilliant Stars Trainer Gallery", "Hidden Fates
  // Shiny Vault") comes in that set's packs.
  for (const s of sets) {
    if (art.has(s.set_name)) continue
    const parent = SUBSET.exec(s.set_name)?.[1]
    const parentArt = parent ? art.get(byName.get(nameKey(parent))?.set_name ?? '') : undefined
    if (parentArt) art.set(s.set_name, parentArt)
  }
  return { art, unmatchedFiles: unmatchedFiles.sort() }
}

/** A subset's name: its parent set's, then what part of it the subset is. */
const SUBSET =
  /^(.+?) (?:Shiny Vault|Trainer Gallery|Galarian Gallery|Classic Collection|Unown Collection)$/

interface PtcgSet {
  id: string
  name: string
  ptcgoCode?: string
  images?: { logo?: string }
}

const scrydexLogo = (id: string): string => `${SCRYDEX_IMAGE_PREFIX}${id}-logo/logo`
const TRAINER_KIT_LOGOS = {
  DP: scrydexLogo('tk3a'),
  HS: scrydexLogo('tk4a'),
  BW: scrydexLogo('tk5a'),
  XY: scrydexLogo('tk6a'),
  SM: scrydexLogo('tk10a')
}

/**
 * Logos checked by eye, for sets whose name doesn't meet the API's. Scrydex serves a placeholder for
 * ids it doesn't know, so these were each looked at. Trainer kits share their era's banner; a
 * subset without its own logo has its parent set's.
 */
const HAND_PICKED_LOGOS: Record<string, string> = {
  '30th Celebration': scrydexLogo('me55'),
  '30th Classic Collection': scrydexLogo('me55c'),
  'SVP Black Star Promos': `${POKEMONTCG_IMAGE_PREFIX}svp/logo.png`,
  'MEP Black Star Promos': scrydexLogo('mep'),
  'Scarlet & Violet Energy': `${POKEMONTCG_IMAGE_PREFIX}sve/logo.png`,
  'Mega Evolution Energy': scrydexLogo('mee'),
  "McDonald's Collection 2023": scrydexLogo('mcd23'),
  "McDonald's Collection 2024": scrydexLogo('mcd24'),
  'Unseen Forces Unown Collection': `${POKEMONTCG_IMAGE_PREFIX}ex10/logo.png`,
  'Radiant Collection': `${POKEMONTCG_IMAGE_PREFIX}bw11/logo.png`,
  'DP trainer Kit (Lucario)': TRAINER_KIT_LOGOS.DP,
  'DP trainer Kit (Manaphy)': TRAINER_KIT_LOGOS.DP,
  'HS trainer Kit (Gyarados)': TRAINER_KIT_LOGOS.HS,
  'HS trainer Kit (Raichu)': TRAINER_KIT_LOGOS.HS,
  'BW trainer Kit (Excadrill)': TRAINER_KIT_LOGOS.BW,
  'BW trainer Kit (Zoroark)': TRAINER_KIT_LOGOS.BW,
  'XY trainer Kit (Bisharp)': TRAINER_KIT_LOGOS.XY,
  'XY trainer Kit (Latias)': TRAINER_KIT_LOGOS.XY,
  'XY trainer Kit (Latios)': TRAINER_KIT_LOGOS.XY,
  'XY trainer Kit (Noivern)': TRAINER_KIT_LOGOS.XY,
  'XY trainer Kit (Pikachu Libre)': TRAINER_KIT_LOGOS.XY,
  'XY trainer Kit (Suicune)': TRAINER_KIT_LOGOS.XY,
  'XY trainer Kit (Sylveon)': TRAINER_KIT_LOGOS.XY,
  'XY trainer Kit (Wigglytuff)': TRAINER_KIT_LOGOS.XY,
  'SM trainer Kit (Alolan Raichu)': TRAINER_KIT_LOGOS.SM,
  'SM trainer Kit (Lycanroc)': TRAINER_KIT_LOGOS.SM
}

/** English sets without a TCGdex logo, matched to a Pokémon TCG API set by name or picked by hand: set name → logo URL. */
export function matchLogos(ptcg: PtcgSet[], sets: SetRow[]): Map<string, string> {
  const byName = new Map<string, string>()
  for (const p of ptcg) {
    const logo = p.images?.logo
    if (logo && isFallbackLogoUrl(logo)) byName.set(nameKey(p.name), logo)
  }
  const out = new Map<string, string>()
  for (const s of sets) {
    if (s.image_url) continue
    const logo = HAND_PICKED_LOGOS[s.set_name] ?? byName.get(nameKey(s.set_name))
    if (logo) out.set(s.set_name, logo)
  }
  return out
}

// ---- The step ---------------------------------------------------------------------------------

export function shouldRefreshSetArt(db: Database.Database, now: Date): boolean {
  const last = getMeta(db, 'pkm_set_art_synced_at')
  if (!last) return true
  const t = Date.parse(last)
  return Number.isNaN(t) || now.getTime() - t >= SET_ART_INTERVAL_MS
}

export interface SetArtOpts {
  version: string
  fetch?: typeof fetch
  pause?: () => Promise<void>
  now?: Date
  log?: (l: string) => void
  /** Matches and reports without writing (the dry run). */
  dryRun?: boolean
  /** First retry backoff in ms; tests pass a tiny value. */
  retryDelayMs?: number
}

const setsOf = (db: Database.Database, lang: TdLang): SetRow[] =>
  db
    .prepare(
      "SELECT set_name, set_code, image_key, image_url FROM sets WHERE game = 'pkm' AND language = ? ORDER BY set_name"
    )
    .all(lang) as SetRow[]

/**
 * Matches and stores Pokémon pack art and fallback logos. Never rejects: a source that fails keeps
 * that kind's stored rows (and the step runs again next night); the week's timer starts only once
 * both sources answered.
 */
export async function refreshPokemonSetArt(
  db: Database.Database,
  opts: SetArtOpts
): Promise<SetArtReport> {
  const fetchFn = opts.fetch ?? fetch
  const userAgent = `DuelBinder/${opts.version} (${REPO_URL}; nightly set art, one request a second)`
  const log = opts.log ?? ((): void => {})
  const report: SetArtReport = {
    packs: {
      en: { matched: 0, sets: 0, unmatchedSets: [] },
      ja: { matched: 0, sets: 0, unmatchedSets: [] }
    },
    logos: { matched: 0, missing: 0, unmatchedSets: [] },
    unmatchedFiles: { en: [], ja: [] },
    problems: []
  }
  const sets = { en: setsOf(db, 'en'), ja: setsOf(db, 'ja') }

  let packs: Map<string, ArchiveFile[]>[] | null = null
  try {
    const files: Record<TdLang, ArchiveFile[]> = { en: [], ja: [] }
    let first = true
    for (const c of CATEGORIES) {
      if (!first) await (opts.pause ?? (() => sleep(BULBAGARDEN_GAP_MS)))()
      first = false
      files[c.lang].push(
        ...(await listCategoryFiles(c.title, {
          fetch: fetchFn,
          userAgent,
          pause: opts.pause,
          retryDelayMs: opts.retryDelayMs,
          flat: c.flat
        }))
      )
    }
    packs = (['en', 'ja'] as const).map((lang) => {
      const { art, unmatchedFiles } = matchPacks(lang, files[lang], sets[lang])
      report.packs[lang] = {
        matched: art.size,
        sets: sets[lang].length,
        unmatchedSets: sets[lang].filter((s) => !art.has(s.set_name)).map((s) => s.set_name)
      }
      report.unmatchedFiles[lang] = unmatchedFiles
      return art
    })
  } catch (e) {
    report.problems.push(`Pack art: ${e instanceof Error ? e.message : String(e)}`)
  }

  let logos: Map<string, string> | null = null
  try {
    const body = await getJsonRetrying<{ data?: PtcgSet[] }>(
      fetchFn,
      POKEMONTCG_SETS_URL,
      userAgent,
      opts.retryDelayMs
    )
    if (!Array.isArray(body.data)) throw new Error('no sets in the response')
    logos = matchLogos(body.data, sets.en)
    const missing = sets.en.filter((s) => !s.image_url)
    report.logos = {
      matched: logos.size,
      missing: missing.length,
      unmatchedSets: missing.filter((s) => !logos!.has(s.set_name)).map((s) => s.set_name)
    }
  } catch (e) {
    report.problems.push(`Set logos: ${e instanceof Error ? e.message : String(e)}`)
  }

  for (const lang of ['en', 'ja'] as const) {
    const p = report.packs[lang]
    log(`Pokémon ${lang} pack art: ${p.matched} of ${p.sets} sets`)
  }
  log(
    `Pokémon en fallback logos: ${report.logos.matched} of ${report.logos.missing} sets without a TCGdex logo`
  )
  for (const p of report.problems) log(`Pokémon set art: ${p}`)
  if (opts.dryRun) return report

  const insert = db.prepare(
    `INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    if (packs) {
      db.exec("DELETE FROM pokemon_set_art WHERE kind = 'pack'")
      ;(['en', 'ja'] as const).forEach((lang, i) => {
        for (const [set, list] of packs![i]) {
          list.forEach((f, order) => {
            const key = bulbagardenKey(f.url)
            if (key) insert.run(lang, set, 'pack', order, f.url, key)
          })
        }
      })
    }
    if (logos) {
      db.exec("DELETE FROM pokemon_set_art WHERE kind = 'logo'")
      for (const [set, url] of logos) {
        const key = pokemontcgKey(url)
        if (key) insert.run('en', set, 'logo', 0, url, key)
      }
    }
  })()
  if (packs && logos) setMeta(db, 'pkm_set_art_synced_at', (opts.now ?? new Date()).toISOString())
  return report
}

// ---- Warming the portal's R2 ------------------------------------------------------------------

/**
 * Asks the portal to mirror each Bulbagarden image `keys` names into R2, one a second, so the
 * archive sees each image fetched once by the job rather than in bursts from clients. Images the
 * portal already holds cost no upstream request. Returns how each went; never rejects.
 */
export async function warmSetArt(opts: {
  url: string
  token: string
  keys: string[]
  fetch?: typeof fetch
  pause?: () => Promise<void>
}): Promise<{ stored: number; cached: number; failed: number }> {
  const fetchFn = opts.fetch ?? fetch
  const pause = opts.pause ?? (() => sleep(BULBAGARDEN_GAP_MS))
  const out = { stored: 0, cached: 0, failed: 0 }
  const base = opts.url.replace(/\/+$/, '')
  let fetchedUpstream = false
  for (const key of opts.keys) {
    if (fetchedUpstream) await pause()
    fetchedUpstream = false
    try {
      const res = await fetchFn(`${base}/admin/img/warm`, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: `set/${key}` }),
        signal: AbortSignal.timeout(60_000)
      })
      const body = res.ok ? ((await res.json()) as { result?: string }) : {}
      if (body.result === 'cached') out.cached++
      else if (body.result === 'stored') {
        out.stored++
        fetchedUpstream = true
      } else {
        out.failed++
        fetchedUpstream = body.result === 'failed'
      }
    } catch {
      out.failed++
      fetchedUpstream = true
    }
  }
  return out
}
