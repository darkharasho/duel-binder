#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- a plain JS script */
// Builds ~/rarity-corpus/tcgplayer: TCGplayer product images across rarities, preferring the same
// card (set code) in several rarities, with a manifest flagging stock renders reused across rarities.
//
//   node scripts/scan/rarity-corpus/tcgplayer.mjs [--target 60] [--max 80] [--dry-run]
//
// Re-runnable: existing images are kept, the manifest is rewritten each run.
import fs from 'node:fs'
import path from 'node:path'
import {
  CORPUS,
  RARITIES,
  availableRarities,
  canonicalRarity,
  downloadTo,
  imageSize,
  log,
  openCatalog,
  pool,
  sha1,
  slugOf,
  thumbDiff,
  thumbnail,
  writeManifest,
  HttpMissing
} from './common.mjs'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const TARGET = Number(arg('target', 60))
const MAX = Number(arg('max', 80))
const DRY = process.argv.includes('--dry-run')
const SOURCE = 'tcgplayer'
const ROOT = path.join(CORPUS, SOURCE)
/** Most images of one rarity from one set prefix, so a rarity isn't all RA01. */
const PREFIX_CAPS = [10, 20, MAX]

const db = openCatalog()
const available = availableRarities(db)

// ---------------------------------------------------------------- products

const baseName = (n) =>
  n
    .replace(/\s*\((?:[^()]*)\)\s*$/g, '')
    .replace(/\s*\((?:[^()]*)\)\s*$/g, '')
    .trim()
const products = db
  .prepare('SELECT product_id, group_id, number, rarity, image_url, name FROM tcgplayer_products')
  .all()
  .map((p) => ({ ...p, canon: canonicalRarity(p.rarity), number: p.number.trim().toUpperCase() }))
  .filter((p) => p.canon)

const byProductId = db.prepare(
  `SELECT p.card_id, p.set_code FROM card_printings p WHERE p.language = 'en' AND p.tcg_product_id = ?`
)
const bySetCode = db.prepare(
  `SELECT card_id, set_rarity FROM card_printings WHERE language = 'en' AND set_code = ? COLLATE NOCASE`
)
const cardOf = db.prepare('SELECT id, name, frame_type FROM cards WHERE id = ?')
const cardByName = db.prepare(
  'SELECT id, name, frame_type FROM cards WHERE name = ? COLLATE NOCASE'
)

/** The catalog card behind a product: its linked printing, else its set code, else its name. */
function resolveCard(p) {
  const linked = byProductId.get(p.product_id)
  if (linked) return { card: cardOf.get(linked.card_id), how: 'tcg_product_id' }
  if (p.number) {
    const rows = bySetCode.all(p.number)
    const ids = [...new Set(rows.map((r) => r.card_id))]
    if (ids.length === 1) return { card: cardOf.get(ids[0]), how: 'set code' }
    const sameRarity = [
      ...new Set(
        rows.filter((r) => canonicalRarity(r.set_rarity) === p.canon).map((r) => r.card_id)
      )
    ]
    if (sameRarity.length === 1)
      return { card: cardOf.get(sameRarity[0]), how: 'set code + rarity' }
  }
  const named = cardByName.get(baseName(p.name))
  if (named) return { card: named, how: 'name' }
  return { card: null, how: 'unresolved' }
}

// Groups: same set code (same card in the same set), else same TCGplayer group + base name.
const groups = new Map()
for (const p of products) {
  p.groupKey = p.number ? p.number : `tcg-group-${p.group_id}:${baseName(p.name)}`
  p.sortKey = p.number ? `tcg:${p.number}` : `tcg:g${p.group_id}:${baseName(p.name)}`
  p.prefix = p.number ? p.number.split('-')[0] : `g${p.group_id}`
  const g = groups.get(p.groupKey) ?? []
  g.push(p)
  groups.set(p.groupKey, g)
}

// ---------------------------------------------------------------- selection

const chosen = []
const count = Object.fromEntries(Object.keys(RARITIES).map((r) => [r, 0]))
const perPrefix = new Map() // `${rarity}|${prefix}` -> n
const taken = new Set()
// Stable pseudo-random order so ties spread over sets instead of following product ids.
const jitter = (s) => parseInt(sha1(s).slice(0, 8), 16)

function room(p, prefixCap, target) {
  return count[p.canon] < target && (perPrefix.get(`${p.canon}|${p.prefix}`) ?? 0) < prefixCap
}
function take(p) {
  taken.add(p.product_id)
  chosen.push(p)
  count[p.canon]++
  const k = `${p.canon}|${p.prefix}`
  perPrefix.set(k, (perPrefix.get(k) ?? 0) + 1)
}

const multi = [...groups.values()]
  .map((g) => {
    // One product per rarity per group (alternate arts aside, the first listed).
    const one = new Map()
    for (const p of g.sort((a, b) => a.product_id - b.product_id))
      if (!one.has(p.canon)) one.set(p.canon, p)
    return [...one.values()]
  })
  .filter((g) => g.length >= 2)
  .sort((a, b) => b.length - a.length || jitter(a[0].sortKey) - jitter(b[0].sortKey))

// Pass 1..n: whole multi-rarity groups, relaxing the per-set cap each pass.
for (const cap of PREFIX_CAPS) {
  for (const g of multi) {
    const fresh = g.filter((p) => !taken.has(p.product_id) && room(p, cap, TARGET))
    const already = g.filter((p) => taken.has(p.product_id)).length
    // Keep groups multi-rarity: only add when the group ends up with >= 2 rarities.
    if (fresh.length + already >= 2 && fresh.length > 0) fresh.forEach(take)
  }
}
// Rarities still short (Gold, Premium Gold, Ghost, Prismatic Secret...): any product, spread over sets.
const singles = products
  .filter((p) => !taken.has(p.product_id))
  .sort((a, b) => jitter(String(a.product_id)) - jitter(String(b.product_id)))
for (const cap of PREFIX_CAPS)
  for (const p of singles) if (!taken.has(p.product_id) && room(p, cap, TARGET)) take(p)

log('selected', chosen.length, 'products')
for (const r of Object.keys(RARITIES)) log(`  ${r}: ${count[r]}`)
if (DRY) process.exit(0)

// ---------------------------------------------------------------- download

let done = 0
const failures = []
await pool(chosen, 4, async (p) => {
  const file = path.join(slugOf(p.canon), `${p.product_id}.jpg`)
  try {
    const buf = await downloadTo(p.image_url, path.join(ROOT, file))
    p.file = file
    p.bytes = buf.length
    p.sha1 = sha1(buf)
    Object.assign(p, imageSize(buf))
  } catch (e) {
    failures.push({
      productId: p.product_id,
      url: p.image_url,
      error: e.message,
      missing: e instanceof HttpMissing
    })
  }
  if (++done % 50 === 0) log(`downloaded ${done}/${chosen.length}`)
})
const got = chosen.filter((p) => p.file)
log(`have ${got.length}, failed ${failures.length}`)

// ---------------------------------------------------------------- shared stock renders

// The same bytes across different set codes is a placeholder ("image coming soon"), not a card.
const sha1Groups = new Map()
for (const p of got)
  sha1Groups.set(p.sha1, new Set([...(sha1Groups.get(p.sha1) ?? []), p.groupKey]))

const inGroup = new Map()
for (const p of got) inGroup.set(p.groupKey, [...(inGroup.get(p.groupKey) ?? []), p])

// Pairwise within each group, at 128 px: separate photos of the same card in two rarities
// differ by ~9+ (mean abs, 0-255) from framing and foil alone; one stock render reused for two
// rarities (re-encoded or not) scores ~3. File size alone says little: most images are 500 px
// JPEGs of similar size, so a size match within 1% only counts alongside a close picture.
const FINE = 128
for (const members of inGroup.values()) {
  const thumbs = new Map()
  for (const p of members) {
    p.sharedWith = []
    p.nearestDiff = null
    try {
      thumbs.set(
        p.product_id,
        members.length > 1 ? thumbnail(fs.readFileSync(path.join(ROOT, p.file)), FINE) : null
      )
    } catch {
      thumbs.set(p.product_id, null)
    }
  }
  for (const p of members) {
    for (const q of members) {
      if (q === p || q.canon === p.canon) continue
      const d = thumbDiff(thumbs.get(p.product_id), thumbs.get(q.product_id))
      if (p.nearestDiff === null || d < p.nearestDiff) p.nearestDiff = d
      const sameBytes = p.sha1 === q.sha1
      const sameSize = Math.abs(p.bytes - q.bytes) / Math.max(p.bytes, q.bytes) <= 0.01
      if (sameBytes || (sameSize && d < 6) || d < 5) p.sharedWith.push(q.product_id)
    }
  }
}

// ---------------------------------------------------------------- manifest

const rows = got.map((p) => {
  const { card, how } = resolveCard(p)
  const placeholder = (sha1Groups.get(p.sha1)?.size ?? 0) > 1
  const sharedImage = p.sharedWith.length > 0
  const row = {
    file: p.file,
    source: SOURCE,
    url: p.image_url,
    productId: p.product_id,
    cardId: card?.id ?? null,
    name: card?.name ?? baseName(p.name),
    productName: p.name,
    frameType: card?.frame_type ?? null,
    setCode: p.number || null,
    rarity: p.canon,
    available: available(card?.id, p.number),
    how: `tcgplayer product rarity; card via ${how}`,
    // The listing's rarity is reliable; whether the photo shows that foil is not when the
    // picture is a stock render reused across rarities, or a placeholder.
    confidence: placeholder ? 'low' : sharedImage ? 'low' : card ? 'medium' : 'low',
    group: p.groupKey,
    sharedImage,
    width: p.width,
    height: p.height,
    sha1: p.sha1
  }
  if (sharedImage) row.sharedWith = p.sharedWith
  if (placeholder) row.placeholder = true
  if (p.nearestDiff !== null) row.nearestOtherRarityDiff = Math.round(p.nearestDiff * 10) / 10
  return row
})
// Visual review notes per rarity (filled in by hand after looking at samples), if present.
const notesFile = path.join(ROOT, 'rarity-notes.json')
if (fs.existsSync(notesFile)) {
  const notes = JSON.parse(fs.readFileSync(notesFile, 'utf8'))
  for (const r of rows) if (notes[r.rarity]) r.rarityNote = notes[r.rarity]
}
writeManifest(SOURCE, rows)
fs.writeFileSync(path.join(ROOT, 'failures.json'), JSON.stringify(failures, null, 1))

// ---------------------------------------------------------------- summary

const summary = {}
for (const r of rows) {
  const s = (summary[r.rarity] ??= { images: 0, shared: 0, unique: 0, placeholder: 0 })
  s.images++
  if (r.placeholder) s.placeholder++
  else if (r.sharedImage) s.shared++
  else s.unique++
}
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
