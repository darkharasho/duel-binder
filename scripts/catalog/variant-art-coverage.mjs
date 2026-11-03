#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- a plain JS script */
// Read-only measurement: how many art-variant printings (overframe, chibi, manga, new art, ...)
// get a Yugipedia printing scan that shows their variant, a plain scan that doesn't (wrong art),
// or none. Runs choosePrintingFile/fileShowsVariant from one or more copies of printingArt.ts over
// the same galleries, so a change can be measured before and after.
//
//   node scripts/catalog/variant-art-coverage.mjs --db ~/.config/duel-binder/collection.db \
//     [--sets LOCH,LOCR,RV01,BLGG,MAMS,MAMO] [--random 150] [--cache /tmp/variant-art-cache] \
//     [--module before=/path/to/old/printingArt.ts] [--module after=src/main/yugipedia/printingArt.ts]
//     [--list wrong|none]
//
// The catalog is opened read-only. Galleries are cached under --cache, so a rerun asks Yugipedia
// nothing; the first run asks for 50 galleries a request, a second apart.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []))
const home = (p) => p.replace(/^~(?=\/)/, os.homedir())

const DB = home(arg('db', '~/.config/duel-binder/collection.db'))
const SETS = arg('sets', 'LOCH,LOCR,RV01,BLGG,MAMS,MAMO').split(',').filter(Boolean)
const RANDOM = Number(arg('random', '150'))
const CACHE = home(arg('cache', '/tmp/variant-art-cache'))
const LIST = arg('list', '')
const UA = 'DuelBinder/variant-art-coverage (https://github.com/darkharasho/duel-binder)'
const modules = (
  all('module').length ? all('module') : ['current=src/main/yugipedia/printingArt.ts']
).map((m) => {
  const eq = m.indexOf('=')
  return { label: m.slice(0, eq), file: path.resolve(m.slice(eq + 1)) }
})

const db = new DatabaseSync(DB, { readOnly: true })
/** The variant a printing names (as namedVariant in src/shared/scan/fingerprintRefs.ts). */
const namedVariant = (rarity, variant) =>
  variant?.trim() || /\(([^()]+)\)\s*$/.exec(rarity)?.[1]?.trim() || null
const family = (rarity) => rarity.replace(/\s*\([^()]*\)\s*$/, '').trim()
/** Foil colours and editions of the usual art: not art variants (NOT_ART and COLOUR there). */
const NOT_ART =
  /edition$|pharaoh's rare|^stamp$|promo|qualifier|date reprint|^replica$|^(chinese|english)$|^(red|blue|green|purple|silver|bronze|gold|yellow|orange|white|pink)$/i
const variantClass = (v) =>
  /overframe/i.test(v)
    ? 'overframe'
    : /chibi/i.test(v)
      ? 'chibi'
      : /manga/i.test(v)
        ? 'manga'
        : /^new art/i.test(v)
          ? 'new art'
          : /alternate|\d(st|nd|rd|th) art/i.test(v)
            ? 'alternate'
            : 'other'

const rows = db
  .prepare(
    `SELECT p.id, p.card_id, c.name, p.set_name, p.set_code, p.language, p.set_rarity,
       p.set_rarity_code, p.variant, p.tcg_product_id
     FROM card_printings p JOIN cards c ON c.id = p.card_id
     WHERE p.game = 'ygo' AND p.set_code <> ''`
  )
  .all()
const plain = new Set(
  rows
    .filter((r) => namedVariant(r.set_rarity, r.variant) === null)
    .map((r) => `${r.language}|${r.set_code}|${r.set_rarity}`)
)
const variants = rows.filter((r) => {
  const v = namedVariant(r.set_rarity, r.variant)
  return v !== null && !NOT_ART.test(v)
})
const inSets = (r) => SETS.includes(r.set_code.split('-')[0].toUpperCase())
const others = [...new Set(variants.filter((r) => !inSets(r)).map((r) => r.card_id))]
  // A fixed spread, so reruns pick the same cards.
  .sort((a, b) => ((a * 2654435761) % 2 ** 32) - ((b * 2654435761) % 2 ** 32))
  .slice(0, RANDOM)
const sample = new Set(others)
const picked = variants.filter((r) => inSets(r) || sample.has(r.card_id))

// Galleries, cached per card name.
fs.mkdirSync(CACHE, { recursive: true })
const title = (n) =>
  `Card Gallery:${n
    .replace(/[#<>[\]{}|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()}`
const cacheFile = (n) => path.join(CACHE, `${encodeURIComponent(n)}.json`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function images(titles) {
  const out = new Map()
  let cont = {}
  let normalized = new Map()
  do {
    const qs = new URLSearchParams({
      action: 'query',
      prop: 'images',
      imlimit: 'max',
      redirects: '1',
      format: 'json',
      formatversion: '2',
      titles: titles.join('|'),
      ...cont
    })
    await sleep(1000)
    const res = await fetch(`https://yugipedia.com/api.php?${qs}`, {
      headers: { 'User-Agent': UA }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    if (Object.keys(cont).length === 0) {
      for (const k of ['normalized', 'redirects'])
        for (const { from, to } of body.query?.[k] ?? []) normalized.set(from, to)
    }
    for (const p of body.query?.pages ?? []) {
      if (p.missing || p.invalid) continue
      out.set(p.title, [
        ...(out.get(p.title) ?? []),
        ...(p.images ?? []).map((i) => i.title.replace(/^File:/, ''))
      ])
    }
    cont = body.continue?.imcontinue
      ? { imcontinue: body.continue.imcontinue, continue: body.continue.continue }
      : {}
  } while (cont.imcontinue)
  const resolve = (t) => {
    let r = t
    for (let i = 0; i < 3 && normalized.has(r); i++) r = normalized.get(r)
    return r
  }
  return new Map(titles.map((t) => [t, out.get(resolve(t))]))
}
const names = [...new Set(picked.map((r) => r.name))]
const todo = names.filter((n) => !fs.existsSync(cacheFile(n)))
for (let i = 0; i < todo.length; i += 50) {
  const part = todo.slice(i, i + 50)
  const first = await images(part.map(title))
  const missing = part.filter((n) => !first.get(title(n)))
  const second = missing.length ? await images(missing.map((n) => `${title(n)} (card)`)) : new Map()
  for (const n of part) {
    const files = first.get(title(n)) ?? second.get(`${title(n)} (card)`) ?? []
    fs.writeFileSync(cacheFile(n), JSON.stringify(files))
  }
  process.stderr.write(`galleries ${Math.min(i + 50, todo.length)}/${todo.length}\n`)
}
const gallery = (n) => JSON.parse(fs.readFileSync(cacheFile(n), 'utf8'))

// One judge for every module: the last one's needsOwnScan and fileShowsVariant. A printing gets
// the right art when its scan shows its variant, or it needs no scan of its own (a foil colour).
const judge = await import(pathToFileURL(modules.at(-1).file).href)
const shows = (file, key, only) =>
  (judge.needsOwnScan ? !judge.needsOwnScan(key) : false) || judge.fileShowsVariant(file, key, only)

for (const m of modules) {
  const { choosePrintingFile, choosePrintingScan } = await import(pathToFileURL(m.file).href)
  // What the resolver stores: choosePrintingScan where there is one, choosePrintingFile before.
  const choose = (files, key, only) =>
    choosePrintingScan ? choosePrintingScan(files, key, only) : choosePrintingFile(files, key)
  const tally = new Map()
  const listed = []
  for (const r of picked) {
    const key = {
      setCode: r.set_code,
      language: r.language,
      rarity: r.set_rarity,
      rarityCode: r.set_rarity_code,
      variant: r.variant
    }
    const only = !plain.has(`${r.language}|${r.set_code}|${family(r.set_rarity)}`)
    const file = choose(gallery(r.name), key, only)
    const outcome = file === null ? 'none' : shows(file, key, only) ? 'right' : 'wrong'
    const group = `${inSets(r) ? r.set_code.split('-')[0] : 'sample'} ${r.language === 'en' ? 'en' : 'ocg/intl'} ${variantClass(namedVariant(r.set_rarity, r.variant))}`
    const t = tally.get(group) ?? { right: 0, wrong: 0, none: 0 }
    t[outcome]++
    tally.set(group, t)
    if (LIST === outcome)
      listed.push(`${r.set_code} ${r.language} ${r.set_rarity} [${r.variant ?? ''}] -> ${file}`)
  }
  console.log(`\n== ${m.label} (${m.file})`)
  const total = { right: 0, wrong: 0, none: 0 }
  for (const [g, t] of [...tally].sort()) {
    console.log(
      `${g.padEnd(32)} right ${String(t.right).padStart(4)}  wrong ${String(t.wrong).padStart(4)}  none ${String(t.none).padStart(4)}`
    )
    for (const k of Object.keys(total)) total[k] += t[k]
  }
  console.log(
    `${'TOTAL'.padEnd(32)} right ${String(total.right).padStart(4)}  wrong ${String(total.wrong).padStart(4)}  none ${String(total.none).padStart(4)}`
  )
  for (const l of listed) console.log('  ' + l)
}
