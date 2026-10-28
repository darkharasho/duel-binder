/* eslint-disable @typescript-eslint/explicit-function-return-type -- a plain JS script */
// Lists the upright cards extract.mjs saved as evaluation items, with their labels from the
// corpus manifests (or, for the owner's webcam shots, ~/scan-capture/shots/rarity-truth.json).
//
//   node scripts/scan/rarity/make-items.mjs <source> [variant] [out.json]
//
// source: ebay, tcgplayer, yugipedia or owner; variant: the suffix of the upright directory
// (deg, small, deg2, ...), so ~/rarity-corpus/upright/<source>-<variant>. Writes
// ~/rarity-corpus/items/<source>[-<variant>].json by default: [{ key, upright, rarity, available,
// frameType, source, confidence, status, setCode, photo, cardId, overframe }].
//
// Left out: cards the scanner didn't find, stock images shared between listings, and those
// listed in ~/rarity-corpus/meta/label-fixes.json ({ "<manifest file>": "reason" }), whose
// label the picture plainly contradicts (a product photo of another rarity's printing).
// Everything read and written here is private and stays out of the repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const CORPUS = join(HOME, 'rarity-corpus')
const [source, variant, outArg] = process.argv.slice(2)
if (!source) throw new Error('usage: make-items.mjs <source> [variant] [out.json]')
const dirName = variant ? `${source}-${variant}` : source
const upright = join(CORPUS, 'upright', dirName)
const readJsonl = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : []
const extracted = new Map(readJsonl(join(upright, 'extract.jsonl')).map((e) => [e.key, e]))
const fixesPath = join(CORPUS, 'meta/label-fixes.json')
const fixes = existsSync(fixesPath) ? JSON.parse(readFileSync(fixesPath, 'utf8')) : {}
const keyOf = (file) =>
  `${source}-${file
    .replace(/\.[^.]+$/, '')
    .replaceAll('/', '__')
    .replace(/[^A-Za-z0-9_.-]/g, '_')}`

const items = []
let skipped = 0
if (source === 'owner') {
  const truth = JSON.parse(readFileSync(join(HOME, 'scan-capture/shots/rarity-truth.json'), 'utf8'))
  for (const t of truth) {
    const e = extracted.get(t.key)
    const path = join(upright, `${t.key}.jpg`)
    if (!e || !existsSync(path) || !t.frameType || t.confidence === 'unsure') {
      skipped++
      continue
    }
    items.push({
      key: t.key,
      upright: path,
      rarity: t.rarity,
      available: t.available,
      frameType: t.frameType,
      source: variant ? `owner-${variant}` : 'owner',
      confidence: t.confidence,
      status: e.status,
      setCode: t.set ?? null,
      photo: true,
      cardId: t.cardId ?? null,
      overframe: t.overframe ?? false
    })
  }
} else {
  const cards = new Map(
    JSON.parse(readFileSync(join(CORPUS, 'meta/cards.json'), 'utf8')).map((c) => [c.id, c])
  )
  for (const m of readJsonl(join(CORPUS, source, 'manifest.jsonl'))) {
    const key = keyOf(m.file)
    const e = extracted.get(key)
    const path = join(upright, `${key}.jpg`)
    const frameType = m.frameType ?? cards.get(m.cardId)?.f
    if (
      !e ||
      !['own', 'forced'].includes(e.status) ||
      !existsSync(path) ||
      m.stock ||
      m.sharedImage ||
      fixes[m.file] ||
      !frameType ||
      !m.available?.length
    ) {
      skipped++
      continue
    }
    items.push({
      key,
      upright: path,
      rarity: m.rarityAsNamed ?? m.rarity,
      available: m.available,
      frameType,
      source: dirName,
      confidence: m.confidence ?? null,
      status: e.status,
      setCode: m.setCode ?? null,
      photo: m.photo ?? null,
      cardId: m.cardId ?? null,
      overframe: false
    })
  }
}
const out = outArg ?? join(CORPUS, 'items', `${dirName}.json`)
mkdirSync(join(out, '..'), { recursive: true })
writeFileSync(out, JSON.stringify(items))
console.log(`${out}: ${items.length} items, ${skipped} skipped`)
