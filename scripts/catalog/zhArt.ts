/**
 * The catalog job's step that copies Simplified Chinese card art from PokiPair into R2
 * (pokemon/pokipairMirror.ts), run before the Pokémon stage, which reads the record it keeps.
 *
 *   npm run catalog:zh-art [-- --dry-run] [-- --budget <images>] [-- --minutes <minutes>]
 *
 * --minutes is how long images are started for (default 45, inside the nightly step's 60); the
 * hand-started bulk run (zh-art.yml) gives it hours.
 *
 * Env: PORTAL_URL, PORTAL_ADMIN_TOKEN (not needed for --dry-run). Reads the zh-hans cards from
 * catalog-work/work.sqlite (last night's) and keeps catalog-work/pokipair.json.
 */
import { existsSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { ZhCatalogCard } from './pokemon/pokipair'
import { ZH_SET_INDEX } from './pokemon/zhPacks'
import {
  mirrorZhArt,
  readZhArtRecord,
  ZH_ART_BUDGET,
  ZH_ART_GAP_MS,
  ZH_ART_RECORD_FILE
} from './pokemon/pokipairMirror'

const WORK_DB = 'catalog-work/work.sqlite'
/** Images are started for this long by default; the nightly step's limit is 60 minutes. */
const DEFAULT_MINUTES = 45
const ZH_ART_RECORD = `catalog-work/${ZH_ART_RECORD_FILE}`

/** The catalog's zh-hans cards by set id, their number the part of the source id after the last dash. */
export function zhCards(db: Database.Database): Map<string, ZhCatalogCard[]> {
  const rows = db
    .prepare(
      "SELECT pc.source_id AS sourceId, c.name, pc.rarity FROM pokemon_cards pc JOIN cards c ON c.id = pc.card_id WHERE pc.source_id LIKE 'zh-hans/%'"
    )
    .all() as { sourceId: string; name: string; rarity: string | null }[]
  const out = new Map<string, ZhCatalogCard[]>()
  for (const r of rows) {
    const m = /^zh-hans\/(.+)-([^-]+)$/.exec(r.sourceId)
    if (!m) continue
    const list = out.get(m[1]) ?? []
    list.push({ sourceId: r.sourceId, number: m[2], name: r.name, rarity: r.rarity })
    out.set(m[1], list)
  }
  return out
}

/** Each zh-hans set's Chinese name, for matching pokemon.cn's products; empty when the list is down. */
async function chineseSetNames(): Promise<Map<string, string>> {
  try {
    const res = await fetch(ZH_SET_INDEX, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const rows = (await res.json()) as { id: string; name: string }[]
    return new Map(rows.map((r) => [r.id, r.name]))
  } catch (e) {
    console.log(
      `zh art: no Chinese set names (${e instanceof Error ? e.message : String(e)}); PokiPair packs only`
    )
    return new Map()
  }
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry-run')
  const at = process.argv.indexOf('--budget')
  const budget = at >= 0 ? Number(process.argv[at + 1]) : ZH_ART_BUDGET
  if (!Number.isInteger(budget) || budget < 0)
    throw new Error('--budget takes a whole number of images')
  const mi = process.argv.indexOf('--minutes')
  const minutes = mi >= 0 ? Number(process.argv[mi + 1]) : DEFAULT_MINUTES
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes takes a number above 0')
  const url = process.env['PORTAL_URL']
  const token = process.env['PORTAL_ADMIN_TOKEN']
  if (!dry && (!url || !token))
    throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set (or pass --dry-run)')
  if (!existsSync(WORK_DB)) {
    console.log(`zh art: no ${WORK_DB} yet; nothing to match`)
    return
  }
  const db = new Database(WORK_DB, { readonly: true })
  const cards = zhCards(db)
  db.close()
  const record = readZhArtRecord(ZH_ART_RECORD)
  const zhNames = await chineseSetNames()
  const r = await mirrorZhArt({
    cards,
    record,
    fetch,
    portal: dry ? undefined : { url: url!, token: token! },
    zhNames,
    budget,
    gapMs: ZH_ART_GAP_MS,
    until: Date.now() + minutes * 60 * 1000,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    save: dry ? undefined : () => writeFileSync(ZH_ART_RECORD, JSON.stringify(record)),
    log: (line) => console.log(line)
  })
  if (!dry) writeFileSync(ZH_ART_RECORD, JSON.stringify(record))
  console.log(
    `zh art: ${r.matched} to copy, ${r.uploaded} copied, ${r.packs} packs, ${r.failed} failed, ${Object.keys(record.done).length} kept in all` +
      (r.stopped ? `; stopped: ${r.stopped}` : '')
  )
}

if (process.argv[1]?.endsWith('zh-art.mjs')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
