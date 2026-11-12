/**
 * Builds the Magic work folder the real-photo run reads (tests/main/scan-mtg-real.test.ts): a
 * Magic-only copy of a catalog's rows for a chosen set of cards, and their fingerprint file, until
 * the nightly file has every look. A tool, not shipped.
 *
 *   vite build --config scripts/catalog/vite.config.ts && ELECTRON_RUN_AS_NODE=1 npx electron \
 *     out/catalog/mtg-corpus-work.mjs <collection.db> <mtg-truth.json> <out dir> [--others 2000] [--seed 1]
 *
 * The cards: every card named by the truth file, every card with a printing in FRA, TFRA or SPG,
 * and `--others` more picked with a fixed seed so the art search meets realistic competition; each
 * in every language. Writes <out>/catalog.sqlite (the source's schema, these rows only) and
 * <out>/fingerprints-mtg.bin, hashing every look of those cards from Scryfall. The hash cache
 * (<out>/fingerprints-mtg.sqlite) is kept, so a rerun fetches only what is new; don't commit it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { buildFingerprints } from '../catalog/fingerprints'

const [source, truthPath, out] = process.argv.slice(2)
const flag = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? fallback : Number(process.argv[i + 1])
}
if (!source || !truthPath || !out) {
  console.error('usage: mtg-corpus-work.mjs <collection.db> <mtg-truth.json> <out dir> [--others N] [--seed N]')
  process.exit(2)
}
const OTHERS = flag('others', 2000)
const SEED = flag('seed', 1)
const SETS = ['FRA', 'TFRA', 'SPG']

/** mulberry32: the same picks for the same seed. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const src = new Database(source, { readonly: true, fileMustExist: true })
const truth = JSON.parse(readFileSync(truthPath, 'utf8')) as { sourceId: string | null }[]

// Oracle ids: a card here is one oracle card in one language, so every language comes along.
const oracleOfCode = src.prepare<[string, string], string>(
  `SELECT m.oracle_id FROM card_printings p JOIN mtg_cards m ON m.card_id = p.card_id
   WHERE p.game = 'mtg' AND p.language = ? AND p.set_code = ? LIMIT 1`
)
const oracles = new Set<string>()
const missing: string[] = []
for (const t of truth) {
  if (!t.sourceId) continue
  const [lang, code] = [t.sourceId.slice(0, t.sourceId.indexOf('/')), t.sourceId.slice(t.sourceId.indexOf('/') + 1)]
  const o = oracleOfCode.pluck().get(lang, code)
  if (o) oracles.add(o)
  else missing.push(t.sourceId)
}
const truthOracles = oracles.size
for (const set of SETS) {
  for (const o of src
    .prepare(
      `SELECT DISTINCT m.oracle_id FROM card_printings p JOIN mtg_cards m ON m.card_id = p.card_id
       WHERE p.game = 'mtg' AND p.set_code LIKE ? || ' %'`
    )
    .pluck()
    .all(set) as string[])
    oracles.add(o)
}
const setOracles = oracles.size - truthOracles
const all = (
  src.prepare("SELECT DISTINCT oracle_id FROM mtg_cards ORDER BY oracle_id").pluck().all() as string[]
).filter((o) => !oracles.has(o))
const pick = random(SEED)
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(pick() * (i + 1))
  ;[all[i], all[j]] = [all[j], all[i]]
}
for (const o of all.slice(0, OTHERS)) oracles.add(o)

mkdirSync(out, { recursive: true })
const catalogPath = join(out, 'catalog.sqlite')
for (const f of [catalogPath, `${catalogPath}-wal`, `${catalogPath}-shm`]) if (existsSync(f)) rmSync(f)
const db = new Database(catalogPath)
// The source's schema, tables and indexes first, then triggers once the rows are in.
const schema = src
  .prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'trigger', rowid"
  )
  .all() as { type: string; sql: string; name: string }[]
// A virtual table (full-text search) makes its own shadow tables.
const virtual = schema.filter((s) => /^CREATE VIRTUAL TABLE/i.test(s.sql)).map((s) => `${s.name}_`)
const ownSchema = schema.filter((s) => !virtual.some((v) => s.name.startsWith(v)))
db.exec(ownSchema.filter((s) => s.type !== 'trigger').map((s) => `${s.sql};`).join('\n'))
src.close()
db.exec(`ATTACH DATABASE '${source.replace(/'/g, "''")}' AS src`)
db.exec('CREATE TEMP TABLE chosen (oracle_id TEXT PRIMARY KEY)')
const choose = db.prepare('INSERT INTO chosen VALUES (?)')
db.transaction(() => oracles.forEach((o) => choose.run(o)))()
db.exec(
  'CREATE TEMP TABLE ids AS SELECT card_id FROM src.mtg_cards WHERE oracle_id IN (SELECT oracle_id FROM chosen)'
)
/** Copies the rows of a table that match `where`, by its plain columns (a generated one can't be written). */
const copy = (table: string, where: string): void => {
  const cols = (
    db.prepare(`SELECT name FROM pragma_table_xinfo(?) WHERE hidden = 0`).pluck().all(table) as string[]
  )
    .map((c) => `"${c}"`)
    .join(', ')
  db.exec(`INSERT INTO main.${table} (${cols}) SELECT ${cols} FROM src.${table} WHERE ${where}`)
}
db.transaction(() => {
  copy('cards', 'id IN (SELECT card_id FROM ids)')
  copy('mtg_cards', 'card_id IN (SELECT card_id FROM ids)')
  copy('card_images', 'card_id IN (SELECT card_id FROM ids)')
  copy('mtg_images', 'image_id IN (SELECT image_id FROM main.card_images)')
  copy('card_printings', "game = 'mtg' AND card_id IN (SELECT card_id FROM ids)")
  copy('sets', "game = 'mtg'")
  copy('meta', "key = 'db_version'")
})()
db.exec('DETACH DATABASE src')
for (const s of ownSchema.filter((x) => x.type === 'trigger')) db.exec(`${s.sql};`)

const result = await buildFingerprints({
  game: 'mtg',
  work: db,
  cachePath: join(out, 'fingerprints-mtg.sqlite'),
  budget: Number.MAX_SAFE_INTEGER,
  userAgent: 'DuelBinder/scan-corpus (https://github.com/darkharasho/duel-binder)',
  // No set counts as recent, so a rerun hashes nothing it has.
  now: () => new Date('2100-01-01'),
  log: (s) => console.log(s)
})
writeFileSync(join(out, 'fingerprints-mtg.bin'), result.bytes)
db.exec('VACUUM')
db.close()

console.log(
  `Oracle cards: ${oracles.size} (${truthOracles} from the truth file, ${setOracles} more from ${SETS.join('/')}, ${oracles.size - truthOracles - setOracles} others)`
)
if (missing.length) console.log(`Truth rows with no printing in the catalog: ${missing.join(', ')}`)
const db2 = new Database(catalogPath, { readonly: true })
console.log(
  `Cards ${db2.prepare('SELECT COUNT(*) FROM cards').pluck().get()}, printings ${db2.prepare('SELECT COUNT(*) FROM card_printings').pluck().get()}, FRA printings ${db2.prepare("SELECT COUNT(*) FROM card_printings WHERE set_code LIKE 'FRA %'").pluck().get()}, images ${db2.prepare('SELECT COUNT(*) FROM mtg_images').pluck().get()}`
)
db2.close()
console.log(
  `Fingerprints: ${result.count} records (${result.fetched} fetched, ${result.failed} failed), ${statSync(join(out, 'fingerprints-mtg.bin')).size} bytes`
)
