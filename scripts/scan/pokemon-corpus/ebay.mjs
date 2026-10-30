#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- a plain JS script */
// Builds a PRIVATE corpus of real photos of Pokémon cards from eBay listings, for the Pokémon
// real-photo scan gate (tests/main/scan-pkm-real.test.ts). Forked from the rarity corpus's
// ebay.mjs. Nothing it writes belongs in the repo: images, the manifest and the API response cache
// all live in ~/scan-capture/ebay-pkm (outside git). Listing photos are other people's images;
// keep the corpus local, never publish or upload it.
//
// Usage:
//   node scripts/scan/pokemon-corpus/ebay.mjs [--db ~/scan-capture/pkm-work/catalog.sqlite]
//        [--out ~/scan-capture/ebay-pkm] [--target 400] [--max-searches 600]
//        [--queries <file.json>]
//
// --queries replaces the built-in per-set searches with a file's: a JSON array of
// { query, lang: 'en' | 'ja', holderHint?: 'slab' | 'toploader' }, e.g. stamped and special
// printings ("pokemon prerelease stamp"). Every filter below still applies. Each manifest row then
// carries a stampHint, the special printing the query names (Prerelease, Staff, 1st Edition, ...).
//
// The catalog is the one scripts/scan/pokemon-corpus/prep.ts builds. Credentials:
// EBAY_PROD_APP_ID / EBAY_PROD_CERT_ID from the repo's .env, the file EBAY_ENV_FILE names, or the
// environment. They are only sent to eBay's OAuth endpoint and are never logged or written
// anywhere. Its own search cap (--max-searches) keeps the nightly price sweep's quota untouched.
//
// How it works: one search per catalog set (English by set name, Japanese by set code), plus
// searches for graded slabs and toploaders, run in a fixed shuffled order so a budget cut short
// still spreads over eras, languages and holders. A listing is kept only when it is one card, its
// title names a catalog collector number ("045/193") in the title's language (Japanese when the
// title says so, any other non-English language rejected) and the name of exactly one card with
// that number (for Japanese, whose catalog names are often Japanese, the set's name or code will
// do; the set also settles a reprint). At most one photo per card and a few per set. Only the main image is saved.
//
// Output: <out>/<lang>/<itemId>.jpg and <out>/manifest.json, the kept photos ({ file (relative to
// the folder above <out>, as pkm-truth.json wants), itemId, title, sourceId, the card the title
// named, its versions, hints, imageUrl, ... }[]); the title is only a hint for labelling, the
// image decides. Dropped images are listed in <out>/dropped.json with why: an image whose bytes
// appear on 2+ listings (a stock image), or one cut exactly to a card's shape (a scan). Raw search
// responses are cached in <out>/cache/search/<sha1>.json, so reruns cost no API calls.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const require = createRequire(import.meta.url)
const Database = require(path.join(repoRoot, 'node_modules/better-sqlite3'))

// ---------- args ----------
const args = process.argv.slice(2)
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const home = (p) => path.resolve(p.replace(/^~/, os.homedir()))
const DB_PATH = home(arg('db', '~/scan-capture/pkm-work/catalog.sqlite'))
const OUT = home(arg('out', '~/scan-capture/ebay-pkm'))
const TARGET = Number(arg('target', 400))
const MAX_SEARCHES = Number(arg('max-searches', 600))
const QUERIES_FILE = arg('queries', null)
/** Shares of TARGET: Japanese photos, and slabs and toploaders at most. */
const JA_SHARE = 0.35
const SLAB_SHARE = 0.2
const TOPLOADER_SHARE = 0.15
const PER_SET = 4
// eBay's "Pokémon Individual Cards" category.
const CATEGORY = '183454'

// ---------- credentials (never printed) ----------
function loadCreds() {
  const env = { ...process.env }
  const envFile = [
    path.join(repoRoot, '.env'),
    // A worktree has no .env of its own: point EBAY_ENV_FILE at the main checkout's.
    process.env.EBAY_ENV_FILE
  ].find((p) => p && fs.existsSync(p))
  if (envFile) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
  if (!env.EBAY_PROD_APP_ID || !env.EBAY_PROD_CERT_ID) throw new Error('missing eBay credentials')
  return { id: env.EBAY_PROD_APP_ID, secret: env.EBAY_PROD_CERT_ID }
}

// ---------- HTTP with politeness ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastApiCall = 0
let apiChain = Promise.resolve()
const stats = { apiCalls: 0, searches: 0, cachedSearches: 0, oauth: 0, downloads: 0 }

// Serialises API calls with >= 500 ms spacing.
function apiSlot() {
  const p = apiChain.then(async () => {
    const wait = lastApiCall + 500 - Date.now()
    if (wait > 0) await sleep(wait)
    lastApiCall = Date.now()
  })
  apiChain = p.catch(() => {})
  return p
}

async function fetchRetry(url, init, { attempts = 4, api = false } = {}) {
  let last = null
  for (let i = 0; i < attempts; i++) {
    if (api) {
      await apiSlot()
      stats.apiCalls++
    }
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
      if (res.status !== 429 && res.status < 500) return res
      last = `http ${res.status}`
    } catch (e) {
      last = `network ${e?.name ?? ''}`
    }
    if (i < attempts - 1) await sleep(1000 * 2 ** i + Math.random() * 300)
  }
  throw new Error(last ?? 'failed')
}

let token = null
async function getToken(creds) {
  if (token && Date.now() < token.expiresAt) return token.value
  stats.oauth++
  const res = await fetchRetry(
    'https://api.ebay.com/identity/v1/oauth2/token',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.id}:${creds.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    },
    { api: true }
  )
  if (res.status !== 200) throw new Error(`oauth ${res.status}`)
  const data = await res.json()
  token = {
    value: data.access_token,
    expiresAt: Date.now() + ((Number(data.expires_in) || 7200) - 120) * 1000
  }
  return token.value
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex')

class BudgetExceeded extends Error {}

async function search(creds, q, { limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({
    q,
    category_ids: CATEGORY,
    limit: String(limit),
    offset: String(offset)
  })
  const key = sha1(`v1|${params}`)
  const file = path.join(OUT, 'cache/search', `${key}.json`)
  if (fs.existsSync(file)) {
    stats.cachedSearches++
    return JSON.parse(fs.readFileSync(file, 'utf8')).itemSummaries ?? []
  }
  if (stats.searches >= MAX_SEARCHES) throw new BudgetExceeded('search budget exhausted')
  stats.searches++
  for (let tries = 0; tries < 2; tries++) {
    const t = await getToken(creds)
    const res = await fetchRetry(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      { headers: { Authorization: `Bearer ${t}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } },
      { api: true }
    )
    if (res.status === 401) {
      token = null
      continue
    }
    if (res.status !== 200) throw new Error(`search ${res.status}`)
    const data = await res.json()
    fs.writeFileSync(
      file,
      JSON.stringify({ q, limit, offset, fetchedAt: new Date().toISOString(), ...data })
    )
    return data.itemSummaries ?? []
  }
  throw new Error('search 401')
}

// ---------- text helpers ----------
const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`]/g, "'")
    .replace(/[^a-z0-9'δ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const hasPhrase = (hay, needle) =>
  !!needle && new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(hay)

/** A collector number's parts without leading zeros ("TG05" -> "TG5", "045" -> "45"). */
const numKey = (s) => s.toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1')

const NUMBER_RE =
  /(?<![A-Za-z0-9])([A-Za-z]{0,3}\d{1,3})\s?\/\s?([A-Za-z]{0,3}\d{1,3})(?![A-Za-z0-9])/g
const JAPANESE = /\b(japanese|japan|jpn|jp)\b/
const OTHER_LANGUAGE =
  /\b(korean|korea|kor|chinese|china|s chinese|t chinese|simplified|traditional|german|deutsch|french|francais|italian|italiano|spanish|espanol|portuguese|indonesian|thai|asian|asia)\b/
// Not one card: lots, choices, sealed product, fakes and odd sizes.
const NOT_ONE_CARD =
  /\b(lots?|bundle|proxy|orica|custom|fake|replica|playsets?|set of \d+|\d+ cards|choose|pick|picks|you pick|u pick|select|selection|your choice|multiple|assorted|mixed|various|complete( your)? set|master set|booster|packs?|box|sealed|etb|elite trainer|tin|binder|sleeves?|playmat|jumbo|oversized?|coin|code cards?|digital|online|metal|art print|poster|sticker|figure|plush|stamp set|empty)\b|\b[2-9]\s?x\b|\bx\s?[2-9]\b/
const SLAB = /\b(psa|bgs|cgc|sgc|beckett|ace|tag|graded|slab)\b/
const TOPLOADER = /\btop ?loaders?\b/
// Words a title uses for a card's version, kept as a labelling hint only.
const VERSION_WORDS =
  /\b(reverse holo(foil)?|reverse|holo(foil|graphic)?|non holo|1st edition|1st ed|first edition|shadowless|unlimited|staff|prerelease|stamped|cosmos)\b/g

// ---------- image helpers ----------
function imageSize(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: 'jpeg' }
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2
        continue
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  if (buf.slice(1, 4).toString() === 'PNG')
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' }
  return { width: null, height: null, format: 'unknown' }
}

/** Special printings a query can name, in the order tried; the first match is the stampHint. */
const STAMP_HINTS = [
  ['Trick or Trade', /trick or treat|trick or trade|halloween|pumpkin/],
  ['Prerelease', /pre ?release/],
  ['Staff', /\bstaff\b/],
  ['Pokemon Center', /pokemon center/],
  ['25th Celebration', /25th|celebrations/],
  ['30th Celebration', /30th/],
  ['Classic Collection', /classic collection/],
  ['1st Edition', /1st ed|first edition/],
  ['Shadowless', /shadowless/],
  ['Cosmos Holo', /cosmos/],
  ["McDonald's", /mcdonalds?/],
  ['League', /\bleague\b/],
  ['World Championships', /world championships?|worlds/],
  ['Snowflake', /snowflake/],
  ['Countdown Calendar', /countdown calendar/],
  ['Set Logo Reverse', /logo/]
]
const stampOf = (query) => {
  const q = norm(query)
  return STAMP_HINTS.find(([, re]) => re.test(q))?.[0] ?? null
}

const bigImage = (url) => url.replace(/s-l\d+(\.\w+)/, 's-l1600$1')

// ---------- catalog ----------
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
const sets = db
  .prepare(
    `SELECT language, set_name AS name, set_code AS code, substr(tcg_date, 1, 4) AS year
       FROM sets WHERE game = 'pkm' AND language IN ('en', 'ja')`
  )
  .all()
const yearOf = new Map(sets.map((s) => [`${s.language}|${s.name}`, s.year ?? '']))
/**
 * A set's code as its printings' set codes start ("SM3+" is "SM3P"), so a set listed twice (a
 * Japanese set under its Japanese and its English name) is one.
 */
const setKey = (lang, code) => `${lang}|${code.toUpperCase().replace(/\+/g, 'P')}`
/** setKey -> every name and code the set goes by. */
const setAliases = new Map()
for (const s of sets) {
  const k = setKey(s.language, s.code)
  if (!setAliases.has(k)) setAliases.set(k, { names: new Set(), codes: new Set() })
  setAliases.get(k).names.add(norm(s.name))
  setAliases.get(k).codes.add(s.code.toLowerCase())
}
/** `${lang}|${number}|${total}` -> the cards printed with that number. */
const byNumber = new Map()
for (const row of db
  .prepare(
    `SELECT c.id AS cardId, c.name, k.source_id AS sourceId, p.language, p.set_code AS setCode,
            p.set_name AS setName, group_concat(p.set_rarity, '|') AS versions
       FROM card_printings p
       JOIN cards c ON c.id = p.card_id
       JOIN pokemon_cards k ON k.card_id = c.id
      WHERE p.game = 'pkm'
      GROUP BY c.id, p.language`
  )
  .iterate()) {
  const m = row.setCode.match(/ ([A-Za-z]*\d+)\/([A-Za-z]*\d+)$/)
  if (!m) continue
  const key = `${row.language}|${numKey(m[1])}|${numKey(m[2])}`
  if (!byNumber.has(key)) byNumber.set(key, [])
  byNumber.get(key).push({ ...row, versions: [...new Set(row.versions.split('|'))].sort() })
}

// ---------- state ----------
const manifestPath = path.join(OUT, 'manifest.json')
const droppedPath = path.join(OUT, 'dropped.json')
const rejectsPath = path.join(OUT, 'rejects.jsonl')
fs.mkdirSync(path.join(OUT, 'cache/search'), { recursive: true })
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [])
const manifest = readJson(manifestPath)
const dropped = readJson(droppedPath)
const seenItems = new Set([...manifest, ...dropped].map((m) => m.itemId))
const bySha = new Map([...manifest, ...dropped].map((m) => [m.sha1, m]))
const byImageUrl = new Map([...manifest, ...dropped].map((m) => [m.imageUrl, m]))
const perCard = new Set(manifest.map((m) => m.cardId))
const perSet = new Map()
for (const m of manifest) perSet.set(m.setName, (perSet.get(m.setName) ?? 0) + 1)
const rejectedItems = new Set()
function save() {
  for (const [file, rows] of [
    [manifestPath, manifest],
    [droppedPath, dropped]
  ]) {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(rows, null, 1))
    fs.renameSync(`${file}.tmp`, file)
  }
}
const rejectLog = fs.createWriteStream(rejectsPath, { flags: 'a' })
const count = (pred) => manifest.filter(pred).length

// ---------- evaluation ----------
function evaluate(item) {
  if (seenItems.has(item.itemId)) return { reject: 'seen' }
  if (!item.image?.imageUrl) return { reject: 'no-image' }
  if (item.itemGroupHref || item.itemGroupType) return { reject: 'multi-variation' }
  const rawTitle = item.title ?? ''
  const t = norm(rawTitle)
  if (NOT_ONE_CARD.test(t)) return { reject: 'not-one-card' }
  if (OTHER_LANGUAGE.test(t)) return { reject: 'other-language' }
  const language = JAPANESE.test(t) ? 'ja' : 'en'
  const numbers = [...rawTitle.matchAll(NUMBER_RE)].map((m) => [numKey(m[1]), numKey(m[2])])
  if (!numbers.length) return { reject: 'no-number' }
  const lower = rawTitle.toLowerCase()
  const inSet = (c) => {
    const code = c.setCode.split(' ')[0]
    const aliases = setAliases.get(setKey(language, code)) ?? { names: [], codes: [] }
    const codes = [code.toLowerCase(), ...aliases.codes]
    return (
      [norm(c.setName), ...aliases.names].some((n) => hasPhrase(t, n)) ||
      codes.some((k) =>
        new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(
          lower
        )
      )
    )
  }
  const numbered = new Map()
  for (const [n, total] of numbers)
    for (const c of byNumber.get(`${language}|${n}|${total}`) ?? []) numbered.set(c.cardId, c)
  if (numbered.size === 0) return { reject: 'no-catalog-card' }
  // The card's name in the title, or, for a Japanese card (whose catalog name is often Japanese
  // while the title's is English), its set's name or code.
  let hits = [...numbered.values()].filter((c) => hasPhrase(t, norm(c.name)))
  if (!hits.length && language === 'ja') hits = [...numbered.values()].filter(inSet)
  if (!hits.length) return { reject: 'name-not-in-title' }
  // One number and name in several sets (a reprint): the set decides, if the title has it.
  if (hits.length > 1) hits = hits.filter(inSet)
  if (hits.length !== 1) return { reject: 'ambiguous' }
  const card = hits[0]
  if (perCard.has(card.cardId)) return { reject: 'card-cap' }
  if ((perSet.get(card.setName) ?? 0) >= PER_SET) return { reject: 'set-cap' }
  const holderHint = SLAB.test(t) ? 'slab' : TOPLOADER.test(t) ? 'toploader' : null
  return { ok: true, card, language, holderHint }
}

/** Room left for a listing of this language and holder, under TARGET's shares. */
function room(ev) {
  if (manifest.length >= TARGET) return false
  if (ev.language === 'ja' && count((m) => m.language === 'ja') >= TARGET * JA_SHARE) return false
  if (ev.language === 'en' && count((m) => m.language === 'en') >= TARGET * (1 - JA_SHARE))
    return false
  if (ev.holderHint === 'slab' && count((m) => m.holderHint === 'slab') >= TARGET * SLAB_SHARE)
    return false
  if (
    ev.holderHint === 'toploader' &&
    count((m) => m.holderHint === 'toploader') >= TARGET * TOPLOADER_SHARE
  )
    return false
  return true
}

/** Drops a kept entry whose image turned out to be a stock one: its file goes, it moves to dropped. */
function drop(entry, why) {
  const abs = path.join(path.dirname(OUT), entry.file)
  if (fs.existsSync(abs)) fs.unlinkSync(abs)
  const i = manifest.indexOf(entry)
  if (i >= 0) {
    manifest.splice(i, 1)
    perCard.delete(entry.cardId)
    perSet.set(entry.setName, (perSet.get(entry.setName) ?? 1) - 1)
    dropped.push({ ...entry, dropped: why })
  } else if (!entry.dropped) entry.dropped = why
}

async function downloadImage(item, ev, query, stampHint) {
  const imageUrl = bigImage(item.image.imageUrl)
  const prior = byImageUrl.get(imageUrl) || byImageUrl.get(item.image.imageUrl)
  if (prior) {
    seenItems.add(item.itemId)
    if (prior.itemId !== item.itemId) drop(prior, 'stock')
    return 'dup-url'
  }
  const base = item.itemId.replace(/[^A-Za-z0-9._-]+/g, '_')
  const abs = path.join(OUT, ev.language, `${base}.jpg`)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  let buf
  if (fs.existsSync(abs)) buf = fs.readFileSync(abs)
  else {
    let res
    try {
      res = await fetchRetry(imageUrl, {}, { attempts: 3 })
      if (res.status !== 200) res = await fetchRetry(item.image.imageUrl, {}, { attempts: 2 })
    } catch {
      return 'download-failed'
    }
    if (res.status !== 200) return 'download-failed'
    buf = Buffer.from(await res.arrayBuffer())
    stats.downloads++
    await sleep(250)
  }
  const h = sha1(buf)
  seenItems.add(item.itemId)
  if (bySha.has(h)) {
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
    drop(bySha.get(h), 'stock')
    return 'dup-sha1'
  }
  const size = imageSize(buf)
  const aspect = size.width && size.height ? size.width / size.height : null
  const entry = {
    file: path.relative(path.dirname(OUT), abs),
    source: 'ebay',
    itemId: item.itemId,
    title: item.title,
    url: String(item.itemWebUrl ?? '').split('?')[0],
    imageUrl,
    query,
    sourceId: ev.card.sourceId,
    cardId: ev.card.cardId,
    name: ev.card.name,
    setName: ev.card.setName,
    setCode: ev.card.setCode,
    year: yearOf.get(`${ev.language}|${ev.card.setName}`) ?? '',
    language: ev.language,
    versions: ev.card.versions,
    versionHint: [...new Set(norm(item.title).match(VERSION_WORDS) ?? [])].join(', ') || null,
    holderHint: ev.holderHint,
    ...(QUERIES_FILE ? { stampHint } : {}),
    sha1: h,
    width: size.width,
    height: size.height,
    bytes: buf.length,
    seller: item.seller?.username ?? null,
    condition: item.condition ?? null
  }
  bySha.set(h, entry)
  byImageUrl.set(imageUrl, entry)
  // Cut exactly to a card's shape (63x88 mm), it's a scan or a stock render, not a photo.
  if (aspect != null && Math.abs(aspect - 63 / 88) < 0.012) {
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
    dropped.push({ ...entry, dropped: 'card-shaped' })
    return 'card-shaped'
  }
  fs.writeFileSync(abs, buf)
  manifest.push(entry)
  perCard.add(entry.cardId)
  perSet.set(entry.setName, (perSet.get(entry.setName) ?? 0) + 1)
  return 'kept'
}

// ---------- queries ----------
/** Deterministic shuffle, so a run cut short by the budget still spreads over every kind. */
const shuffled = (xs, salt) =>
  xs
    .map((x) => ({ x, k: sha1(`${salt}|${JSON.stringify(x)}`) }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .map((e) => e.x)

function queries() {
  if (QUERIES_FILE) {
    const rows = JSON.parse(fs.readFileSync(home(QUERIES_FILE), 'utf8'))
    return shuffled(
      rows.map((r) => ({
        q: r.query,
        kind: r.holderHint ?? r.lang,
        lang: r.lang,
        stampHint: stampOf(r.query)
      })),
      'queries'
    )
  }
  const ascii = (s) => /^[\x20-\x7e]+$/.test(s)
  const en = sets
    .filter((s) => s.language === 'en')
    .map((s) => ({ q: `pokemon "${s.name}"`, kind: 'en' }))
  const ja = sets
    .filter((s) => s.language === 'ja')
    .map((s) => ({
      q: ascii(s.name) ? `pokemon japanese "${s.name}"` : `pokemon japanese ${s.code}`,
      kind: 'ja'
    }))
  // Slabs and toploaders, over a spread of English sets and a few Japanese searches.
  const enSets = shuffled(
    sets.filter((s) => s.language === 'en'),
    'holder'
  )
  const holders = [
    ...enSets.slice(0, 40).map((s) => ({ q: `pokemon PSA "${s.name}"`, kind: 'slab' })),
    ...enSets.slice(40, 60).map((s) => ({ q: `pokemon CGC "${s.name}"`, kind: 'slab' })),
    ...enSets.slice(60, 90).map((s) => ({ q: `pokemon toploader "${s.name}"`, kind: 'toploader' })),
    ...['PSA', 'CGC', 'BGS', 'toploader'].map((w) => ({ q: `pokemon japanese ${w}`, kind: 'ja' }))
  ]
  // Interleaved, so each kind gets its turn early.
  const lists = [shuffled(en, 'en'), shuffled(ja, 'ja'), shuffled(holders, 'holders')]
  const out = []
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}

// ---------- main ----------
async function main() {
  const creds = loadCreds()
  const reasons = {}
  let failures = 0
  for (const { q, kind, lang, stampHint } of queries()) {
    if (manifest.length >= TARGET) break
    // A kind whose share is full needs no more searches.
    const probe = {
      language: (lang ?? kind) === 'ja' ? 'ja' : 'en',
      holderHint: kind === 'slab' || kind === 'toploader' ? kind : null
    }
    if (!room(probe)) continue
    let items
    try {
      items = await search(creds, q)
      failures = 0
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        console.log('search budget exhausted')
        break
      }
      if (++failures >= 5) throw new Error('too many failures', { cause: e })
      console.log(`  search failed (${String(e.message).split(' ').slice(0, 2).join(' ')})`)
      continue
    }
    const queue = []
    for (const item of items) {
      if (rejectedItems.has(item.itemId)) continue
      const ev = evaluate(item)
      if (ev.ok && queue.some((x) => x.ev.card.cardId === ev.card.cardId)) continue
      if (ev.ok && !room(ev)) {
        reasons.full = (reasons.full ?? 0) + 1
        continue
      }
      if (!ev.ok) {
        reasons[ev.reject] = (reasons[ev.reject] ?? 0) + 1
        rejectedItems.add(item.itemId)
        if (!['seen', 'no-number', 'card-cap', 'set-cap'].includes(ev.reject))
          rejectLog.write(
            JSON.stringify({ itemId: item.itemId, title: item.title, reason: ev.reject }) + '\n'
          )
        continue
      }
      queue.push({ item, ev })
      // Set caps count the queue too.
      perSet.set(ev.card.setName, (perSet.get(ev.card.setName) ?? 0) + 1)
      perCard.add(ev.card.cardId)
    }
    // Undo the queue's provisional counts; downloadImage counts what it keeps.
    for (const { ev } of queue) {
      perSet.set(ev.card.setName, perSet.get(ev.card.setName) - 1)
      perCard.delete(ev.card.cardId)
    }
    // Two downloads at a time.
    for (let i = 0; i < queue.length; i += 2) {
      const batch = queue.slice(i, i + 2).filter(({ ev }) => room(ev))
      const results = await Promise.all(
        batch.map(({ item, ev }) => downloadImage(item, ev, q, stampHint))
      )
      for (const r of results) reasons[r] = (reasons[r] ?? 0) + 1
    }
    save()
    console.log(
      `${new Date().toISOString().slice(11, 19)} [${kind}] ${q}: ${items.length} listings, kept ${manifest.length} (searches ${stats.searches})`
    )
  }
  save()
  rejectLog.end()
  const tally = (key) =>
    manifest.reduce((m, e) => ({ ...m, [e[key] ?? '-']: (m[e[key] ?? '-'] ?? 0) + 1 }), {})
  const decades = manifest.reduce((m, e) => {
    const d = e.year ? `${e.year.slice(0, 3)}0s` : '-'
    return { ...m, [d]: (m[d] ?? 0) + 1 }
  }, {})
  const summary = {
    kept: manifest.length,
    dropped: dropped.length,
    language: tally('language'),
    holderHint: tally('holderHint'),
    decades,
    sets: new Set(manifest.map((m) => m.setName)).size,
    reasons
  }
  fs.appendFileSync(
    path.join(OUT, 'runs.jsonl'),
    JSON.stringify({ finishedAt: new Date().toISOString(), stats, summary }) + '\n'
  )
  console.log(JSON.stringify({ stats, summary }, null, 1))
}

main().catch((e) => {
  console.error('fatal', String(e?.message ?? e).split('\n')[0])
  process.exit(1)
})
