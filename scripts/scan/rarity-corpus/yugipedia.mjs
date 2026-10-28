#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- a plain JS script */
// Builds ~/rarity-corpus/yugipedia: Yugipedia printing scans labelled by rarity, focused on
// Starlight Rares and other special foils, each with the same card's other rarities in the same
// set, plus the RA01/LEDE/LOCR scans already on disk (/tmp/avramax, /tmp/locr).
//
//   node scripts/scan/rarity-corpus/yugipedia.mjs [--starlight 55] [--per 30] [--dry-run]
//
// File naming follows src/main/yugipedia/printingArt.ts (choosePrintingFile, rarityAbbr):
// <Card>-<SETPREFIX>-<REGION>-<RARITY>[-<EDITION>][-<variant>].<ext>
// Re-runnable: API answers are cached under cache/, existing images are kept.
import fs from 'node:fs'
import path from 'node:path'
import { choosePrintingFile, rarityAbbr } from '../../../src/main/yugipedia/printingArt.ts'
import {
  CORPUS,
  RARITIES,
  availableRarities,
  cachedJson,
  canonicalRarity,
  downloadTo,
  imageSize,
  log,
  openCatalog,
  sha1,
  slugOf,
  sleep,
  writeManifest
} from './common.mjs'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const STARLIGHT = Number(arg('starlight', 55))
const PER = Number(arg('per', 30))
const DRY = process.argv.includes('--dry-run')
const SOURCE = 'yugipedia'
const ROOT = path.join(CORPUS, SOURCE)
const CACHE = path.join(ROOT, 'cache')
const API = 'https://yugipedia.com/api.php'
const EXISTING_DIRS = [
  '/tmp/avramax/sample',
  '/tmp/avramax/sample-lede',
  '/tmp/avramax/dl',
  '/tmp/avramax/reasoning',
  '/tmp/avramax/ctrl',
  '/tmp/avramax/lg',
  '/tmp/locr/img'
]

/** Rarities sought, with how many card+set groups to take for each and the most per set prefix. */
const FOCUS = [
  ['Starlight Rare', STARLIGHT, 3],
  ['Ghost Rare', PER, 4],
  ['Ultimate Rare', PER, 4],
  ["Collector's Rare", PER, 4],
  ['Prismatic Ultimate Rare', PER, 8],
  ["Prismatic Collector's Rare", PER, 8],
  ['Gold Rare', PER, 5],
  ['Premium Gold Rare', PER, 5],
  ['Platinum Secret Rare', PER, 4],
  ['Quarter Century Secret Rare', PER, 4],
  ['Prismatic Secret Rare', PER, 4]
]

// File-name rarity code -> canonical rarity, from the repo's own abbreviations, plus the RA-set
// prismatic foils the catalog has no printings for.
const CODE_TO_RARITY = new Map()
for (const r of Object.keys(RARITIES)) {
  const code = rarityAbbr(r)
  if (code) CODE_TO_RARITY.set(code.toLowerCase(), r)
}
CODE_TO_RARITY.set('pcr', "Prismatic Collector's Rare")
CODE_TO_RARITY.set('pur', 'Prismatic Ultimate Rare')
CODE_TO_RARITY.set('pscr', 'Prismatic Secret Rare')
/**
 * Rarity Masters / 25th Anniversary Rarity Collection (RA01-RA05) "Collector's" and "Ultimate"
 * Rares are the prismatic versions (TCGplayer's names), unlike the classic foils of the same name.
 */
const PRISMATIC_SETS = /^RA0\d$/
function effectiveRarity(rarity, prefix) {
  if (!PRISMATIC_SETS.test(prefix)) return rarity
  if (rarity === "Collector's Rare") return "Prismatic Collector's Rare"
  if (rarity === 'Ultimate Rare') return 'Prismatic Ultimate Rare'
  return rarity
}
const FILE_RE =
  /^(?:(\d+)__)?([^-]+)-([A-Za-z0-9]+)-([A-Z]{2})-([A-Za-z0-9]+)(?:-([^.]+))?\.(png|jpe?g|gif|webp)$/i
const parseFile = (f) => {
  const m = FILE_RE.exec(f.replace(/^File:/, ''))
  if (!m) return null
  return {
    cardId: m[1] ? Number(m[1]) : null,
    page: m[2],
    prefix: m[3].toUpperCase(),
    region: m[4].toUpperCase(),
    code: m[5],
    rest: m[6] ?? '',
    ext: m[7].toLowerCase()
  }
}

const db = openCatalog()
const available = availableRarities(db)
const jitter = (s) => parseInt(sha1(s).slice(0, 8), 16)

// ---------------------------------------------------------------- MediaWiki API (cached)

async function api(params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })
  for (let attempt = 0; ; attempt++) {
    try {
      const body = await cachedJson(`${API}?${qs}`, CACHE)
      if (body.error) throw new Error(`API error ${body.error.code}`)
      return body
    } catch (e) {
      if (attempt >= 5) throw e
      log(`API retry ${attempt + 1}: ${e.message}`)
      await sleep(2000 * 2 ** attempt)
    }
  }
}

function resolver(body) {
  const norm = new Map((body.query?.normalized ?? []).map((n) => [n.from, n.to]))
  const redir = new Map((body.query?.redirects ?? []).map((n) => [n.from, n.to]))
  return (t) => {
    const n = norm.get(t) ?? t
    return redir.get(n) ?? n
  }
}

const chunk = (a, n) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

/** Files on each card's gallery page (prop=images, following continuation). */
async function listPageImages(titles) {
  const out = new Map()
  for (const part of chunk(titles, 50)) {
    const byTitle = new Map()
    let resolve = (t) => t
    let cont = {}
    let first = true
    do {
      const body = await api({
        action: 'query',
        prop: 'images',
        imlimit: 'max',
        redirects: '1',
        titles: part.join('|'),
        ...cont
      })
      if (first) resolve = resolver(body)
      first = false
      for (const p of body.query?.pages ?? []) {
        const files = byTitle.get(p.title) ?? []
        for (const i of p.images ?? []) files.push(i.title.replace(/^File:/, ''))
        byTitle.set(p.title, files)
      }
      cont = body.continue?.imcontinue
        ? { imcontinue: body.continue.imcontinue, continue: body.continue.continue ?? '' }
        : {}
    } while (cont.imcontinue)
    for (const t of part) {
      const files = byTitle.get(resolve(t))
      if (files) out.set(t, files)
    }
  }
  return out
}

/** Original URL and size per file name. */
async function imageInfo(files) {
  const out = new Map()
  for (const part of chunk(files, 50)) {
    const body = await api({
      action: 'query',
      prop: 'imageinfo',
      // Yugipedia refuses iiurlwidth outside its own pages ("thumbsize-blocked"), so originals.
      iiprop: 'url|size',
      titles: part.map((f) => `File:${f}`).join('|')
    })
    const byTitle = new Map((body.query?.pages ?? []).map((p) => [p.title, p]))
    const resolve = resolver(body)
    for (const f of part) {
      const ii = byTitle.get(resolve(`File:${f}`))?.imageinfo?.[0]
      if (ii?.url) out.set(f, ii)
    }
  }
  return out
}

// ---------------------------------------------------------------- selection

const printings = db
  .prepare(
    `SELECT p.id, p.card_id, c.name, c.frame_type, p.set_code, p.set_rarity, p.set_rarity_code, p.variant, a.url AS art_url
     FROM card_printings p JOIN cards c ON c.id = p.card_id LEFT JOIN printing_art a ON a.printing_id = p.id
     WHERE p.language = 'en' AND p.set_code <> '' AND p.set_code LIKE '%-%'`
  )
  .all()
  .map((p) => {
    const prefix = p.set_code.split('-')[0].toUpperCase()
    const named = canonicalRarity(p.set_rarity)
    return { ...p, prefix, named, canon: named && effectiveRarity(named, prefix) }
  })

// Groups: one card in one set code.
const groups = new Map()
for (const p of printings) {
  const key = p.set_code.toUpperCase()
  const g = groups.get(key) ?? {
    key,
    cardId: p.card_id,
    name: p.name,
    frameType: p.frame_type,
    prefix: p.prefix,
    setCode: p.set_code,
    printings: []
  }
  if (g.cardId !== p.card_id) continue // a code shared by two cards: keep the first card
  g.printings.push(p)
  groups.set(key, g)
}
for (const g of groups.values())
  g.rarities = new Set(g.printings.map((p) => p.canon).filter(Boolean))

// ---------------------------------------------------------------- galleries -> files

const galleries = new Map() // 'Card Gallery:<name>' -> files
const info = new Map() // file -> imageinfo, or null when the file doesn't exist (yet)
const filesOf = new Map() // group key -> Map(rarity -> entry)

/** One scan per rarity Yugipedia lists for this card in this set (English regions). */
function chooseFiles(g) {
  const files = galleries.get(`Card Gallery:${g.name}`) ?? []
  const byRarity = new Map()
  for (const f of files) {
    const m = parseFile(f)
    if (!m || m.prefix !== g.prefix || !['EN', 'NA', 'EU', 'AU'].includes(m.region)) continue
    const named = CODE_TO_RARITY.get(m.code.toLowerCase())
    if (!named) continue
    const rarity = effectiveRarity(named, m.prefix)
    byRarity.set(rarity, [...(byRarity.get(rarity) ?? []), f])
  }
  const out = new Map()
  for (const [rarity, fs_] of byRarity) {
    const printing = g.printings.find((p) => p.canon === rarity && !p.variant)
    // A catalog printing's own scan (printing_art) wins, when it's of this rarity.
    const artFile = printing?.art_url ? decodeURIComponent(printing.art_url.split('/').pop()) : null
    const artParsed = artFile && parseFile(artFile)
    let file
    let how
    if (
      artParsed &&
      effectiveRarity(CODE_TO_RARITY.get(artParsed.code.toLowerCase()), artParsed.prefix) === rarity
    ) {
      file = artFile
      how = 'printing_art url (yugipedia file name)'
    } else {
      file = choosePrintingFile(fs_, { setCode: g.setCode, language: 'en', rarity, rarityCode: '' })
      how = 'yugipedia file name (gallery, choosePrintingFile)'
    }
    if (!file) continue
    const inCatalog = g.rarities.has(rarity)
    out.set(rarity, {
      file,
      group: g,
      rarity,
      named: CODE_TO_RARITY.get(parseFile(file)?.code.toLowerCase()) ?? rarity,
      how: inCatalog ? how : `${how}; rarity not in catalog for this set code`,
      confidence: inCatalog ? 'high' : 'medium',
      artUrl: how.startsWith('printing_art') ? printing.art_url : null
    })
  }
  return out
}

/** Galleries and file existence for a batch of groups (cached API calls). */
async function check(list) {
  const need = [...new Set(list.map((g) => `Card Gallery:${g.name}`))].filter(
    (t) => !galleries.has(t)
  )
  if (need.length) {
    const got = await listPageImages(need)
    for (const t of need) galleries.set(t, got.get(t) ?? [])
  }
  const files = []
  for (const g of list) {
    const m = chooseFiles(g)
    filesOf.set(g.key, m)
    for (const e of m.values()) if (!info.has(e.file)) files.push(e.file)
  }
  const ii = await imageInfo([...new Set(files)])
  for (const f of files) info.set(f, ii.get(f) ?? null)
}

// Groups for each focus rarity whose scan of that rarity exists on Yugipedia; newer sets often
// list scans on the gallery page that haven't been uploaded yet.
const picked = new Map()
const perFocus = {}
for (const [rarity, target, cap] of FOCUS) {
  const perPrefix = new Map()
  let n = [...picked.values()].filter((g) => info.get(filesOf.get(g.key)?.get(rarity)?.file)).length
  const candidates = [...groups.values()]
    .filter((g) => g.rarities.has(rarity) && !picked.has(g.key))
    .sort((a, b) => b.rarities.size - a.rarities.size || jitter(a.key) - jitter(b.key))
  for (const g of picked.values())
    if (g.rarities.has(rarity)) perPrefix.set(g.prefix, (perPrefix.get(g.prefix) ?? 0) + 1)
  // Two passes: the per-set cap first, then without it if the rarity is still short.
  for (const c of [cap, Infinity]) {
    for (let i = 0; i < candidates.length && n < target; i++) {
      const g = candidates[i]
      if (picked.has(g.key) || (perPrefix.get(g.prefix) ?? 0) >= c) continue
      if (!filesOf.has(g.key)) {
        // Look ahead: check the next 50 unchecked candidates in one go.
        const batch = []
        for (let j = i; j < candidates.length && batch.length < 50; j++) {
          const h = candidates[j]
          if (!filesOf.has(h.key) && !picked.has(h.key) && (perPrefix.get(h.prefix) ?? 0) < c)
            batch.push(h)
        }
        await check(batch)
      }
      if (!info.get(filesOf.get(g.key)?.get(rarity)?.file)) continue
      picked.set(g.key, g)
      perPrefix.set(g.prefix, (perPrefix.get(g.prefix) ?? 0) + 1)
      n++
    }
  }
  perFocus[rarity] = n
}
log('picked', picked.size, 'card+set groups', perFocus)

/** Wanted downloads: file name -> entry; only files that exist. */
const wanted = new Map()
let missing = 0
for (const g of picked.values()) {
  for (const e of filesOf.get(g.key).values()) {
    if (wanted.has(e.file)) continue
    if (!info.get(e.file)) {
      missing++
      continue
    }
    wanted.set(e.file, e)
  }
}
const plan = {}
for (const w of wanted.values()) plan[w.rarity] = (plan[w.rarity] ?? 0) + 1
log(`files wanted: ${wanted.size}; listed but not uploaded: ${missing}`, plan)
if (DRY) process.exit(0)

// ---------------------------------------------------------------- download

const rows = []
const failures = []
let done = 0
const entries = [...wanted.entries()]
await (async () => {
  let i = 0
  await Promise.all(
    [0, 1].map(async () => {
      while (i < entries.length) {
        const [file, w] = entries[i++]
        const ii = info.get(file)
        const url = w.artUrl ?? ii?.url
        if (!url) {
          failures.push({ file, error: 'no imageinfo' })
          continue
        }
        const rel = path.join(slugOf(w.rarity), file)
        try {
          const buf = await downloadTo(url, path.join(ROOT, rel))
          rows.push(rowFor(rel, url, file, w, buf))
        } catch (e) {
          failures.push({ file, url, error: e.message })
        }
        if (++done % 50 === 0) log(`downloaded ${done}/${entries.length}`)
      }
    })
  )
})()

function rowFor(rel, url, file, w, buf) {
  const g = w.group
  const { width, height } = imageSize(buf)
  return {
    file: rel,
    source: SOURCE,
    url,
    cardId: g.cardId,
    name: g.name,
    frameType: g.frameType,
    setCode: g.setCode,
    rarity: w.rarity,
    ...(w.named !== w.rarity ? { rarityAsNamed: w.named } : {}),
    available: available(g.cardId, g.setCode),
    how: w.how,
    confidence: w.confidence,
    group: g.setCode.toUpperCase(),
    yugipediaFile: file,
    width,
    height,
    sha1: sha1(buf)
  }
}

// ---------------------------------------------------------------- scans already on disk

const compact = (s) =>
  s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()
const cardsByCompact = new Map()
for (const c of db.prepare('SELECT id, name, frame_type FROM cards').all()) {
  const k = compact(c.name)
  if (!cardsByCompact.has(k)) cardsByCompact.set(k, c)
}
const cardById = db.prepare('SELECT id, name, frame_type FROM cards WHERE id = ?')
const codeFor = db.prepare(
  `SELECT set_code FROM card_printings WHERE card_id = ? AND set_code LIKE ? || '-%' ORDER BY language = 'en' DESC, set_code LIMIT 1`
)
const seenFiles = new Set(rows.map((r) => r.yugipediaFile))
let imported = 0
for (const dir of EXISTING_DIRS) {
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir)) {
    const m = parseFile(f)
    if (!m) continue
    const named = CODE_TO_RARITY.get(m.code.toLowerCase())
    const rarity = named && effectiveRarity(named, m.prefix)
    const yFile = f.replace(/^\d+__/, '')
    if (!rarity || seenFiles.has(yFile)) continue
    seenFiles.add(yFile)
    const card =
      (m.cardId && cardById.get(m.cardId)) || cardsByCompact.get(m.page.toLowerCase()) || null
    const setCode = card ? (codeFor.get(card.id, m.prefix)?.set_code ?? m.prefix) : m.prefix
    const rel = path.join(slugOf(rarity), yFile)
    const dest = path.join(ROOT, rel)
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(path.join(dir, f), dest)
    }
    const buf = fs.readFileSync(dest)
    const { width, height } = imageSize(buf)
    rows.push({
      file: rel,
      source: SOURCE,
      url: `https://yugipedia.com/wiki/File:${encodeURIComponent(yFile)}`,
      cardId: card?.id ?? null,
      name: card?.name ?? m.page,
      frameType: card?.frame_type ?? null,
      setCode,
      rarity,
      ...(named !== rarity ? { rarityAsNamed: named } : {}),
      available: card ? available(card.id, setCode) : [],
      how: `yugipedia file name (copied from ${dir})`,
      confidence: card ? 'high' : 'medium',
      group: setCode.toUpperCase(),
      yugipediaFile: yFile,
      region: m.region,
      width,
      height,
      sha1: sha1(buf)
    })
    imported++
  }
}
log(`imported ${imported} existing scans`)

writeManifest(SOURCE, rows)
fs.writeFileSync(path.join(ROOT, 'failures.json'), JSON.stringify(failures, null, 1))

const summary = {}
for (const r of rows) summary[r.rarity] = (summary[r.rarity] ?? 0) + 1
const groupRarities = new Map()
for (const r of rows)
  groupRarities.set(r.group, new Set([...(groupRarities.get(r.group) ?? []), r.rarity]))
const multiGroups = [...groupRarities.values()].filter((s) => s.size >= 2).length
console.table(summary)
log(`multi-rarity groups: ${multiGroups}; images: ${rows.length}; failures: ${failures.length}`)
fs.writeFileSync(
  path.join(ROOT, 'summary.json'),
  JSON.stringify({ summary, multiGroups, failures: failures.length }, null, 1)
)
