import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { distance, isFrozen, refreshArt, type ArtBatch, type ArtPortal } from './art'
import { BANDAI_JA } from './bandai'
import { openOpCache, type OpCache } from './cache'
import { createOnePieceSources, dedupeEntries, type OnePieceSources } from './sources'
import type { BandaiEntry, BandaiSeries } from './types'
import { entryKind } from './versions'
import { writeOnePiece, type OnePieceReport } from './write'

/**
 * The nightly job's Japanese One Piece step (the design's Step 5a): Bandai's Japanese card list,
 * written as `language = 'ja'` rows. There is no TCGplayer for Japanese, so nothing is priced here
 * (the portal's eBay sweep prices them); a parallel's version label is borrowed from the English
 * entry of the same number whose art it matches, if exactly one does.
 */

/** A Japanese and an English picture this close are the same art (measured 20–52 on OP05). */
export const TWIN_MAX = 64
/** The next English entry must be this much further away (measured 108–136 for other art). */
export const TWIN_MARGIN = 40

export interface JapaneseReport extends OnePieceReport {
  /** Parallels written tonight with their English twin's label. */
  labelled: number
}

export interface JapaneseStepOpts {
  /** The job-local Japanese source cache (catalog-work/onepiece-ja-src.sqlite). */
  cachePath: string
  /** The English step's source cache, read for its art hashes; may not exist. */
  englishCachePath: string
  version: string
  log: (l: string) => void
  /** Where art is uploaded; absent on a dry run. */
  portal?: ArtPortal
  /** Replaces the live sources (tests). */
  sources?: OnePieceSources
  now?: () => Date
  /** Art downloads tonight; defaults to ART_BUDGET. */
  budget?: number
}

export interface JapaneseStepResult {
  report: JapaneseReport | null
  error: string | null
  problems: string[]
}

/** The English art hashes (unfrozen) by Bandai id; empty when there is no English cache yet. */
export function englishArt(path: string): Map<string, string> {
  if (!existsSync(path)) return new Map()
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bandai_art'").get()
    if (!has) return new Map()
    const rows = db.prepare('SELECT bandai_id, hash FROM bandai_art WHERE changed_hash IS NULL').all() as {
      bandai_id: string
      hash: string
    }[]
    return new Map(rows.map((r) => [r.bandai_id, r.hash]))
  } finally {
    db.close()
  }
}

/** `SR (Alternate Art 2)` → `Alternate Art`; null for a label with no version, a reprint or a plain parallel's number only. */
export function versionOfLabel(label: string): string | null {
  const m = /^\S+ \((.+)\)$/.exec(label)
  if (!m) return null
  const inner = m[1].replace(/ \d+$/, '')
  if (/^\d+$/.test(inner) || inner === 'Reprint') return null
  return inner
}

export interface EnglishVersion {
  bandaiId: string
  label: string
  hash: string
}

/**
 * The English label a Japanese parallel borrows: the version of the one English entry of its number
 * within TWIN_MAX bits of its art, with every other English entry of the number TWIN_MARGIN further.
 * Null when none or two are that close, or the twin's label names no version (a base card's art).
 */
export function twinLabel(hash: string, english: EnglishVersion[]): string | null {
  const by = english.map((e) => ({ e, d: distance(hash, e.hash) })).sort((a, b) => a.d - b.d)
  if (by.length === 0 || by[0].d > TWIN_MAX) return null
  if (by.length > 1 && by[1].d - by[0].d < TWIN_MARGIN) return null
  return versionOfLabel(by[0].e.label)
}

/** Takes the English set's name for a Japanese series with the same set code, so both read alike. */
function englishNames(work: Database.Database, series: BandaiSeries[]): BandaiSeries[] {
  const named = work.prepare("SELECT set_name FROM sets WHERE game = 'op' AND language = 'en' AND set_code = ?")
  return series.map((s) => {
    const en = named.get(s.setCode) as { set_name: string } | undefined
    return en ? { ...s, setName: en.set_name } : s
  })
}

export async function runOnePieceJapaneseStep(work: Database.Database, o: JapaneseStepOpts): Promise<JapaneseStepResult> {
  const problems: string[] = []
  let opened: OpCache | undefined
  try {
    const cache = (opened = openOpCache(o.cachePath))
    const sources = o.sources ?? createOnePieceSources({ cache, version: o.version, log: o.log, site: BANDAI_JA })
    const date = o.now?.() ?? new Date()
    const now = date.getTime()
    const notes: string[] = []

    // 1. Fetch. No TCGCSV dates: a series is "recent" by when the cache first saw it.
    const listed = await sources.series()
    notes.push(...listed.notes)
    const series = englishNames(work, listed.series)
    const published = new Map<string, number>()
    const fetched = await sources.entries(series, published)
    problems.push(...fetched.problems)
    notes.push(...fetched.notes)
    const deduped = dedupeEntries(series, fetched.entries, published)
    notes.push(...deduped.notes)
    const entries = deduped.entries

    // 2. Art, in the site's order (newest first within each kind).
    const entriesOf = new Map<string, BandaiEntry[]>()
    for (const e of entries) entriesOf.set(e.seriesId, [...(entriesOf.get(e.seriesId) ?? []), e])
    const batches: ArtBatch[] = series.map((s) => ({ seriesId: s.id, entries: entriesOf.get(s.id) ?? [], candidates: [] }))
    const art = await refreshArt({
      cache, sources, batches, stored: new Map(), portal: o.portal, now, log: o.log, budget: o.budget, region: 'ja'
    })
    for (const id of art.firstNoticed) problems.push(`Bandai Japanese art changed: ${id}`)
    for (const id of art.tooLarge)
      notes.push(`${id}: Bandai art is too large for the portal; not downloaded again until its re-check`)

    const hashed = new Set<string>()
    const frozen = new Set<string>()
    for (const e of entries) {
      if (!cache.getBandaiArt(e.bandaiId)) continue
      hashed.add(e.bandaiId)
      if (isFrozen(cache, e.bandaiId)) frozen.add(e.bandaiId)
    }

    // 3. Labels from the English twins. English promo and other-product entries are left out: their
    // labels name an event, not a version.
    const englishHash = englishArt(o.englishCachePath)
    const englishOf = work.prepare(
      `SELECT p.set_rarity_code AS bandaiId, p.set_rarity AS label FROM card_printings p
       JOIN sets s ON s.game = 'op' AND s.language = 'en' AND s.set_name = p.set_name
       WHERE p.game = 'op' AND p.language = 'en' AND p.contributed = 0 AND p.set_code = ? AND s.set_code NOT IN ('P', 'OPC')`
    )
    const seriesById = new Map(series.map((s) => [s.id, s]))
    const labels = new Map<string, string>()
    for (const e of entries) {
      const s = seriesById.get(e.seriesId)
      if (!s || entryKind(e, s) !== 'parallel') continue
      const own = cache.getBandaiArt(e.bandaiId)
      if (!own) continue
      const english = (englishOf.all(e.number) as { bandaiId: string; label: string }[])
        .map((r) => ({ ...r, hash: englishHash.get(r.bandaiId) ?? '' }))
        .filter((r) => r.hash !== '')
      const label = twinLabel(own.hash, english)
      if (label) labels.set(e.bandaiId, label)
    }

    // 4. Write.
    const firstSeen = cache.firstSeenAll()
    const before = new Set(
      (work.prepare("SELECT set_rarity_code AS c FROM card_printings WHERE game = 'op' AND language = 'ja'").all() as { c: string }[]).map((r) => r.c)
    )
    const written = writeOnePiece(
      work,
      { series, entries, groupOf: new Map(), matches: new Map(), prices: new Map(), hashed, frozen, firstSeen, labels },
      { now, nowIso: date.toISOString(), region: 'ja' }
    )
    let labelled = 0
    for (const [id] of labels) if (!before.has(id) && hashed.has(id) && !frozen.has(id)) labelled++
    return { report: { ...written, notes: [...notes, ...written.notes], labelled }, error: null, problems }
  } catch (e) {
    return { report: null, error: e instanceof Error ? e.message : String(e), problems }
  } finally {
    opened?.close()
  }
}

/** The step's summary line, one line per set, then every note. */
export function logOnePieceJapanese(r: JapaneseReport, log: (line: string) => void): void {
  log(
    `One Piece ja: ${r.series} series, ${r.cards} cards, ${r.printings} printings (${r.held} held), ${r.images} images, ${r.labelled} parallels labelled from English, ${r.notes.length} notes`
  )
  for (const s of r.perSet) log(`One Piece ja ${s.setCode}: ${s.printings} printings`)
  for (const n of r.notes) log(`One Piece ja: ${n}`)
}
