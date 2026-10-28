#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- a plain JS script */
// Builds a PRIVATE corpus of real photos of Yu-Gi-Oh! cards labelled by rarity, from eBay
// listings, for evaluating the scanner's rarity detector. Nothing it writes belongs in the repo:
// images, the manifest and the API response cache all live in ~/rarity-corpus/ebay (outside git).
// Listing photos are other people's images; keep the corpus local and never publish it.
//
// Usage:
//   node scripts/scan/rarity-corpus/ebay.mjs [--db /tmp/rc-catalog.db] [--out ~/rarity-corpus/ebay]
//        [--target 60] [--max-searches 1400] [--only "Starlight Rare,Ghost Rare"]
//
// Credentials: EBAY_PROD_APP_ID / EBAY_PROD_CERT_ID from the repo's .env (or the environment).
// They are only sent to eBay's OAuth endpoint and are never logged or written anywhere.
//
// How it works, per target rarity:
//   1. Broad searches ("<rarity>" in category 31395, US) pull up to a few hundred listings; set
//      codes are parsed from titles and cross-checked against the catalog.
//   2. Targeted searches ('"<SET-CODE>" <rarity>') over catalog printings of that rarity, spread
//      round-robin across sets (newer sets first), fill up to --target images.
//   A listing is kept only when the title contains the set code, names exactly the target rarity
//   (after stripping the card and set names), passes isSingleCard, is not multi-variation or
//   non-English, and the catalog lists that rarity for the code. Only the main image is saved.
//
// Output: <out>/<rarity-slug>/<itemId>.jpg and <out>/manifest.jsonl (one object per image).
// Raw search responses are cached in <out>/cache/search/<sha1>.json so reruns cost no API calls;
// already-downloaded images are skipped. Images whose bytes appear on 2+ listings are kept once
// and flagged stock: true (likely a stock scan, not a photo).

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isSingleCard } from '../../../workers/ebay-prices/src/price.js'

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
const DB_PATH = arg('db', '/tmp/rc-catalog.db')
const OUT = path.resolve(
  arg('out', path.join(os.homedir(), 'rarity-corpus/ebay')).replace(/^~/, os.homedir())
)
const TARGET = Number(arg('target', 60))
const MAX_SEARCHES = Number(arg('max-searches', 1400))
const PER_RARITY_SEARCHES = Number(arg('per-rarity-searches', 90))
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const RARITIES = [
  'Starlight Rare',
  'Secret Rare',
  'Ultra Rare',
  'Super Rare',
  'Ultimate Rare',
  'Ghost Rare',
  "Collector's Rare",
  'Quarter Century Secret Rare',
  'Platinum Secret Rare',
  'Prismatic Secret Rare',
  'Rare',
  'Common',
  'Premium Gold Rare',
  'Gold Rare'
]
const slug = (r) =>
  r
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// ---------- credentials (never printed) ----------
function loadCreds() {
  const env = { ...process.env }
  const envFile = [
    path.join(repoRoot, '.env'),
    '/var/home/mstephens/Documents/GitHub/duel-binder/.env'
  ].find((p) => fs.existsSync(p))
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

// Serialises API calls with >= 350 ms spacing.
function apiSlot() {
  const p = apiChain.then(async () => {
    const wait = lastApiCall + 350 - Date.now()
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

async function search(creds, q, { limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({
    q,
    category_ids: '31395',
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
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// Removes the first occurrence of `needle` (word-bounded, normalised) from `hay`.
function removePhrase(hay, needle) {
  if (!needle) return { text: hay, hit: false }
  const re = new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`)
  if (!re.test(hay)) return { text: hay, hit: false }
  return { text: hay.replace(re, ' ').replace(/\s+/g, ' ').trim(), hit: true }
}

// Strips the card name (longest matching prefix, >= 2 words or the whole name).
function stripName(t, name) {
  const words = norm(name).split(' ').filter(Boolean)
  for (let n = words.length; n >= Math.min(2, words.length); n--) {
    const r = removePhrase(t, words.slice(0, n).join(' '))
    if (r.hit) return { text: r.text, matched: true, full: n === words.length }
  }
  return { text: t, matched: false, full: false }
}

// Order matters: specific phrases are consumed before generic ones. `abbr` hits give medium confidence.
const RARITY_RULES = [
  {
    r: 'Quarter Century Secret Rare',
    full: /\bquarter century( secret)?( rare)?\b/,
    abbr: /\b(qcsr|qcscr|qcs|qc secret( rare)?|qc)\b/
  },
  { r: 'Prismatic Secret Rare', full: /\bprismatic( secret)?( rare)?\b/, abbr: /\b(pscr)\b/ },
  {
    r: 'Platinum Secret Rare',
    full: /\bplatinum secret( rare)?\b/,
    abbr: /\b(plscr|plsr|pscr plat)\b/
  },
  { r: 'Premium Gold Rare', full: /\bpremium gold( rare)?\b/, abbr: /\b(pgr)\b/ },
  { r: 'Starlight Rare', full: /\bstarlight( rare)?\b/, abbr: /\b(str|slr)\b/ },
  { r: 'Ghost Rare', full: /\bghost( rare)?\b/, abbr: /\b(ghr)\b/ },
  { r: 'Ultimate Rare', full: /\bultimate( rare)?\b/, abbr: /\b(utr|ulr)\b/ },
  { r: "Collector's Rare", full: /\bcollectors? rare\b/, abbr: /\b(cr|collectors)\b/ },
  // Other rarities we don't target: any hit rejects the listing.
  {
    r: 'OTHER',
    full: /\b(gold secret( rare)?|10000 secret( rare)?|20th secret( rare)?|20th anniversary secret|pharaohs? rare|platinum( rare)?|starfoil|shatterfoil|mosaic|parallel|duel terminal|short print|grand master|millennium( rare)?|ultra rare (blue|green|purple|red|silver)|rare (blue|green|purple|red))\b/
  },
  { r: 'Secret Rare', full: /\bsecret( rare)?\b/, abbr: /\b(scr|secr|sec)\b/ },
  { r: 'Ultra Rare', full: /\bultra( rare)?\b/, abbr: /\b(ur)\b/ },
  { r: 'Super Rare', full: /\bsuper( rare)?\b/, abbr: /\b(sr)\b/ },
  { r: 'Gold Rare', full: /\bgold( rare)?\b/, abbr: /\b(gur)\b/ },
  { r: 'Rare', full: /\brare\b/ },
  { r: 'Common', full: /\bcommon\b/ }
]

/** Returns Map(rarity -> 'full'|'abbr') of rarities named by an already-stripped, normalised title. */
function namedRarities(t) {
  const found = new Map()
  let s = ` ${t} `
  for (const rule of RARITY_RULES) {
    for (const [kind, re] of [
      ['full', rule.full],
      ['abbr', rule.abbr]
    ]) {
      if (!re) continue
      const g = new RegExp(re.source, 'g')
      if (g.test(s)) {
        if (!found.has(rule.r) || kind === 'full') found.set(rule.r, kind)
        s = s.replace(new RegExp(re.source, 'g'), ' ')
      }
    }
  }
  return found
}

const NON_ENGLISH =
  /\b(japanese|japan|jpn|jp|korean|korea|kr|kor|german|deutsch|french|francais|italian|italiano|spanish|espanol|portuguese|chinese|asian|asia|ocg|simplified|traditional)\b/
const MULTI =
  /\b(choose|pick|picks|you pick|u pick|select|selection|complete your|singles|variations?|your choice|multiple|assorted|mixed|various|card list|from list|lots?)\b/
// Noise that contains rarity words without naming a rarity.
const NOISE = [
  /\bultra pro\b/g,
  /\bultra ?pro\b/g,
  /\brarity collection\b/g,
  /\bsuper fast\b/g,
  /\bsecret slayers\b/g,
  /\bsecret forces\b/g,
  /\bghosts from the past\b/g,
  /\bsuper ?fast\b/g,
  /\bcommon ?wealth\b/g
]

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
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
    const kind = buf.slice(12, 16).toString()
    if (kind === 'VP8X')
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), format: 'webp' }
    if (kind === 'VP8 ')
      return {
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
        format: 'webp'
      }
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff), format: 'webp' }
    }
  }
  return { width: null, height: null, format: 'unknown' }
}

const bigImage = (url) => url.replace(/s-l\d+(\.\w+)/, 's-l1600$1')

// ---------- catalog ----------
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
const printingsByCode = new Map() // UPPER code -> [{cardId, name, frameType, rarity, setName, date}]
for (const row of db
  .prepare(
    `SELECT p.card_id cardId, c.name, c.frame_type frameType, p.set_code code, p.set_rarity rarity, p.set_name setName,
            s.tcg_date date
       FROM card_printings p JOIN cards c ON c.id = p.card_id
       LEFT JOIN sets s ON s.language = 'en' AND s.set_name = p.set_name
      WHERE p.language = 'en'`
  )
  .iterate()) {
  const k = row.code.toUpperCase()
  // Catalog has case variants like "PLatinum Secret Rare".
  row.rarity = RARITIES.find((r) => r.toLowerCase() === row.rarity.toLowerCase()) ?? row.rarity
  if (!printingsByCode.has(k)) printingsByCode.set(k, [])
  printingsByCode.get(k).push(row)
}
const CODE_RE = /\b([A-Z0-9]{2,5}-(?:EN|E)?[A-Z]?\d{2,3}[A-Z]?)\b/gi

// ---------- state ----------
const manifestPath = path.join(OUT, 'manifest.jsonl')
const rejectsPath = path.join(OUT, 'rejects.jsonl')
fs.mkdirSync(path.join(OUT, 'cache/search'), { recursive: true })
const manifest = fs.existsSync(manifestPath)
  ? fs
      .readFileSync(manifestPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : []
const seenItems = new Set(manifest.map((m) => m.itemId))
const bySha = new Map(manifest.map((m) => [m.sha1, m]))
const byImageUrl = new Map(manifest.map((m) => [m.imageUrl, m]))
const rejectedItems = new Set() // itemIds already evaluated and rejected this run
function saveManifest() {
  const tmp = `${manifestPath}.tmp`
  fs.writeFileSync(
    tmp,
    manifest.map((m) => JSON.stringify(m)).join('\n') + (manifest.length ? '\n' : '')
  )
  fs.renameSync(tmp, manifestPath)
}
const rejectLog = fs.createWriteStream(rejectsPath, { flags: 'a' })

// ---------- evaluation ----------
function evaluate(item, target) {
  if (seenItems.has(item.itemId)) return { reject: 'seen' }
  const rawTitle = item.title ?? ''
  if (!item.image?.imageUrl) return { reject: 'no-image' }
  if (item.itemGroupHref || item.itemGroupType) return { reject: 'multi-variation' }
  if (!isSingleCard(rawTitle)) return { reject: 'not-single' }
  let t = norm(rawTitle)
  if (MULTI.test(t)) return { reject: 'multi' }
  if (NON_ENGLISH.test(t)) return { reject: 'non-english' }

  // Find a code in the title whose catalog printings include the target rarity.
  const codes = [...new Set([...rawTitle.matchAll(CODE_RE)].map((m) => m[1].toUpperCase()))]
  const known = codes.filter((c) => printingsByCode.has(c))
  if (known.length === 0) return { reject: 'no-code' }
  if (known.length > 1) return { reject: 'many-codes' }
  const code = known[0]
  const rows = printingsByCode.get(code)
  const available = [...new Set(rows.map((r) => r.rarity))].sort()
  const cards = [...new Set(rows.map((r) => r.cardId))]
  if (!available.includes(target)) return { reject: 'catalog-lacks-rarity', code }
  let row = rows.find((r) => r.rarity === target)
  if (cards.length > 1) {
    // A code shared by several cards: require the name to pick the card.
    const hit = rows.filter((r) => r.rarity === target && stripName(t, r.name).matched)
    if (hit.length !== 1) return { reject: 'ambiguous-code', code }
    row = hit[0]
  }

  // Strip code, card name, set name and noise before reading rarities.
  t = t.replace(new RegExp(`\\b${norm(code).replace(/ /g, ' ?')}\\b`, 'g'), ' ')
  const nm = stripName(t, row.name)
  t = nm.text
  const setN = norm(row.setName)
  t = removePhrase(t, setN).text
  if (row.setName.includes(':')) t = removePhrase(t, norm(row.setName.split(':')[0])).text
  if (
    /\b(fake|replica|art card|digital|sleeves?|playmat|binder|tin|booster|packs?|box|sealed|deck box)\b/.test(
      t
    )
  )
    return { reject: 'not-card', code }
  for (const re of NOISE) t = t.replace(re, ' ')
  t = t.replace(/\b1st( ed(ition)?)?\b|\bunlimited\b|\blimited edition\b/g, ' ')

  const named = namedRarities(t)
  if (!named.has(target)) return { reject: 'rarity-not-named', code }
  if (named.size > 1)
    return {
      reject: `other-rarity:${[...named.keys()].filter((k) => k !== target).join('/')}`,
      code
    }
  const kind = named.get(target)
  const confidence = kind === 'full' && nm.matched ? 'high' : 'medium'
  return {
    ok: true,
    code,
    row,
    available,
    nameMatched: nm.matched,
    nameMatchedFull: nm.full,
    rarityTerm: kind,
    confidence
  }
}

async function downloadImage(item, target, ev) {
  const imageUrl = bigImage(item.image.imageUrl)
  const prior = byImageUrl.get(imageUrl) || byImageUrl.get(item.image.imageUrl)
  if (prior) return markDup(prior, item, 'url')
  const dir = path.join(OUT, slug(target))
  fs.mkdirSync(dir, { recursive: true })
  const base = item.itemId.replace(/[^A-Za-z0-9._-]+/g, '_')
  const rel = path.join(slug(target), `${base}.jpg`)
  const abs = path.join(OUT, rel)
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
    await sleep(150)
  }
  const h = sha1(buf)
  if (bySha.has(h)) {
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
    return markDup(bySha.get(h), item, 'sha1')
  }
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf)
  const size = imageSize(buf)
  const aspect = size.width && size.height ? size.width / size.height : null
  const entry = {
    file: rel,
    source: 'ebay',
    itemId: item.itemId,
    title: item.title,
    url: String(item.itemWebUrl ?? '').split('?')[0],
    imageUrl,
    cardId: ev.row.cardId,
    name: ev.row.name,
    frameType: ev.row.frameType,
    setCode: ev.code,
    setName: ev.row.setName,
    rarity: target,
    available: ev.available,
    how: 'title+catalog',
    confidence: ev.confidence,
    nameMatched: ev.nameMatched,
    rarityTerm: ev.rarityTerm,
    sha1: h,
    width: size.width,
    height: size.height,
    bytes: buf.length,
    stock: false,
    dupListings: [],
    // Heuristic: an exact card-shaped frame (59x86) usually means a scan/stock image, not a photo.
    cardShaped: aspect != null && Math.abs(aspect - 59 / 86) < 0.012,
    photo: null,
    seller: item.seller?.username ?? null,
    condition: item.condition ?? null
  }
  entry.photo = !entry.stock && !entry.cardShaped
  manifest.push(entry)
  seenItems.add(item.itemId)
  bySha.set(h, entry)
  byImageUrl.set(imageUrl, entry)
  return 'kept'
}

function markDup(prior, item, by) {
  if (prior.itemId === item.itemId) return 'seen'
  if (!prior.dupListings.includes(item.itemId)) prior.dupListings.push(item.itemId)
  prior.stock = true
  prior.photo = false
  seenItems.add(item.itemId)
  return `dup-${by}`
}

// ---------- per-rarity driver ----------
function printingsFor(target) {
  const rows = []
  for (const [code, list] of printingsByCode) {
    for (const r of list) if (r.rarity === target) rows.push({ ...r, code })
  }
  // Group by set prefix, newest sets first, then round-robin so codes spread across many sets.
  const bySet = new Map()
  for (const r of rows) {
    const k = r.code.split('-')[0]
    if (!bySet.has(k)) bySet.set(k, { date: r.date ?? '', rows: [] })
    const g = bySet.get(k)
    if ((r.date ?? '') > g.date) g.date = r.date
    g.rows.push(r)
  }
  const sets = [...bySet.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  // Deterministic shuffle inside each set.
  for (const s of sets) s.rows.sort((a, b) => sha1(a.code).localeCompare(sha1(b.code)))
  // Weight newer sets: the newest third gets two picks per round.
  const out = []
  const third = Math.ceil(sets.length / 3)
  let progress = true
  for (let round = 0; progress; round++) {
    progress = false
    sets.forEach((s, i) => {
      const take = i < third ? 2 : 1
      for (let j = 0; j < take; j++) {
        const r = s.rows[round * take + j]
        if (r) {
          out.push(r)
          progress = true
        }
      }
    })
  }
  return out
}

async function runRarity(creds, target) {
  const kept = () => manifest.filter((m) => m.rarity === target).length
  const perCard = new Map()
  const perSet = new Map()
  for (const m of manifest.filter((x) => x.rarity === target)) {
    perCard.set(m.cardId, (perCard.get(m.cardId) ?? 0) + 1)
    const s = m.setCode.split('-')[0]
    perSet.set(s, (perSet.get(s) ?? 0) + 1)
  }
  const reasons = {}
  let searches = 0
  let failures = 0
  // Spread across sets, but rarities printed in only a few sets need a looser cap.
  const nSets = new Set(printingsFor(target).map((p) => p.code.split('-')[0])).size
  const maxPerSet = Math.max(8, Math.ceil((TARGET * 1.5) / Math.max(1, nSets)))

  async function consider(items, { fromBroad }) {
    const queue = []
    for (const item of items) {
      if (kept() + queue.length >= (fromBroad ? Math.ceil(TARGET * 0.6) : TARGET)) break
      if (rejectedItems.has(`${target}|${item.itemId}`)) continue
      const ev = evaluate(item, target)
      if (!ev.ok) {
        reasons[ev.reject] = (reasons[ev.reject] ?? 0) + 1
        rejectedItems.add(`${target}|${item.itemId}`)
        if (ev.reject !== 'seen' && ev.reject !== 'no-code')
          rejectLog.write(
            JSON.stringify({
              rarity: target,
              itemId: item.itemId,
              title: item.title,
              reason: ev.reject
            }) + '\n'
          )
        continue
      }
      const cardN =
        (perCard.get(ev.row.cardId) ?? 0) +
        queue.filter((q) => q.ev.row.cardId === ev.row.cardId).length
      if (cardN >= 2) {
        reasons['card-cap'] = (reasons['card-cap'] ?? 0) + 1
        continue
      }
      const s = ev.code.split('-')[0]
      const setN = (perSet.get(s) ?? 0) + queue.filter((q) => q.ev.code.split('-')[0] === s).length
      if (fromBroad && setN >= maxPerSet) {
        reasons['set-cap'] = (reasons['set-cap'] ?? 0) + 1
        continue
      }
      queue.push({ item, ev })
    }
    // Two downloads at a time.
    for (let i = 0; i < queue.length; i += 2) {
      const batch = queue.slice(i, i + 2)
      const results = await Promise.all(
        batch.map(({ item, ev }) => downloadImage(item, target, ev))
      )
      results.forEach((res, j) => {
        reasons[res] = (reasons[res] ?? 0) + 1
        if (res === 'kept') {
          const { ev } = batch[j]
          perCard.set(ev.row.cardId, (perCard.get(ev.row.cardId) ?? 0) + 1)
          const s = ev.code.split('-')[0]
          perSet.set(s, (perSet.get(s) ?? 0) + 1)
        }
      })
    }
    saveManifest()
  }

  async function doSearch(q, opts) {
    if (failures >= 5) throw new Error('too many failures')
    try {
      const items = await search(creds, q, opts)
      failures = 0
      searches++
      return items
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e
      failures++
      console.log(
        `  search failed (${String(e.message).split(' ').slice(0, 2).join(' ')}), failures=${failures}`
      )
      return []
    }
  }

  // Phase 1: broad.
  const broadQ =
    target === 'Rare'
      ? 'yugioh rare'
      : target === 'Common'
        ? 'yugioh common'
        : `"${target.replace("Collector's", 'Collectors')}"`
  for (let page = 0; page < 3 && kept() < Math.ceil(TARGET * 0.6); page++) {
    const items = await doSearch(broadQ, { limit: 200, offset: page * 200 })
    await consider(items, { fromBroad: true })
    if (items.length < 200) break
  }
  console.log(`  broad phase: kept=${kept()}`)

  // Phase 2: targeted printings.
  const tried = new Set()
  for (const p of printingsFor(target)) {
    if (kept() >= TARGET || searches >= PER_RARITY_SEARCHES) break
    if ((perCard.get(p.cardId) ?? 0) >= 2) continue
    if ((perSet.get(p.code.split('-')[0]) ?? 0) >= maxPerSet) continue
    if (tried.has(p.code)) continue
    tried.add(p.code)
    const r = target === "Collector's Rare" ? 'Collectors Rare' : target
    const items = await doSearch(`"${p.code}" ${r}`, { limit: 50 })
    await consider(items, { fromBroad: false })
  }
  return { kept: kept(), searches, reasons }
}

// ---------- main ----------
async function main() {
  const creds = loadCreds()
  const summary = {}
  const targets = ONLY.length ? RARITIES.filter((r) => ONLY.includes(r)) : RARITIES
  for (const target of targets) {
    console.log(`[${target}] start (have ${manifest.filter((m) => m.rarity === target).length})`)
    try {
      summary[target] = await runRarity(creds, target)
    } catch (e) {
      console.log(`  aborted: ${String(e.message).split(' ').slice(0, 3).join(' ')}`)
      summary[target] = { aborted: true, kept: manifest.filter((m) => m.rarity === target).length }
      if (e instanceof BudgetExceeded) break
    }
    console.log(
      `[${target}] kept=${summary[target].kept} searches=${summary[target].searches ?? '?'} api=${stats.apiCalls}`
    )
    if (summary[target].reasons) console.log(`  reasons ${JSON.stringify(summary[target].reasons)}`)
  }
  saveManifest()
  rejectLog.end()
  const runLog = { finishedAt: new Date().toISOString(), stats, summary }
  fs.appendFileSync(path.join(OUT, 'runs.jsonl'), JSON.stringify(runLog) + '\n')
  console.log(JSON.stringify(stats))
}

main().catch((e) => {
  console.error('fatal', String(e?.message ?? e).split('\n')[0])
  process.exit(1)
})
