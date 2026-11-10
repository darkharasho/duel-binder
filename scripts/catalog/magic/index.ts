import type Database from 'better-sqlite3'
import { MTG_LANGUAGES } from '../../../src/shared/games/magic'
import { pricedShareProblems, type SetStat } from '../priceShare'
import { openMagicCache, type MagicCache } from './cache'
import { mtgRows } from './rows'
import { createScryfall, isKept } from './scryfall'
import type { ScryCard, ScryfallSource } from './types'
import { writeMagic, type MagicReport } from './write'

export interface MagicStepOpts {
  /** The job-local source cache (catalog-work/magic-src.sqlite). */
  cachePath: string
  version: string
  log: (l: string) => void
  /** Replaces the live Scryfall source (tests). */
  source?: ScryfallSource
  now?: () => Date
}

export interface MagicStepResult {
  report: MagicReport | null
  error: string | null
  problems: string[]
}

/**
 * The nightly job's Magic step: Scryfall's `all_cards` bulk file, every kept language, written as mtg rows.
 * Any throw (a source down, a short file, an id collision) is returned as `error`; writeMagic writes
 * in one transaction at the end, so the work database keeps last night's rows.
 */
export async function runMagicStep(
  work: Database.Database,
  o: MagicStepOpts
): Promise<MagicStepResult> {
  const problems: string[] = []
  let opened: MagicCache | undefined
  try {
    // Inside the try: a corrupt or locked cache file is tonight's error, not a failed job.
    const cache = (opened = openMagicCache(o.cachePath))
    const source = o.source ?? createScryfall({ version: o.version })
    const date = o.now?.() ?? new Date()

    const info = await source.bulkInfo()
    const sets = await source.sets()
    const kept: ScryCard[] = []
    for await (const c of source.cards(info.downloadUri)) if (isKept(c)) kept.push(c)
    const rows = mtgRows(kept, sets)
    const written = writeMagic(work, rows, {
      now: date.getTime(),
      nowIso: date.toISOString(),
      updatedAt: info.updatedAt
    })

    // The rows are committed by now: a failure from here on is a problem, not a skipped night.
    try {
      const old = new Map<string, SetStat>()
      for (const s of written.perSet) {
        const prev = cache.getSetStats(s.setCode)
        if (prev) old.set(s.setCode, prev)
      }
      problems.push(...pricedShareProblems(old, written.perSet))
      for (const s of written.perSet) cache.putSetStats(s)
    } catch (e) {
      problems.push(`Magic set stats not saved: ${e instanceof Error ? e.message : String(e)}`)
    }

    return { report: written, error: null, problems }
  } catch (e) {
    return { report: null, error: e instanceof Error ? e.message : String(e), problems }
  } finally {
    opened?.close()
  }
}

/** Below this share priced, a set is worth a log line (all ~950 would bury the log). */
const LOW_SHARE_PERCENT = 80

/** The step's summary line, a line per language tonight, a line per poorly priced English set, then every note. */
export function logMagic(r: MagicReport, log: (line: string) => void): void {
  log(
    `Magic (${r.updatedAt}): ${r.sets} sets, ${r.cards} cards, ${r.images} images, ${r.printings} printings (${r.priced} priced), ${r.missing} missing, ${r.notes.length} notes`
  )
  for (const lang of new Set(Object.values(MTG_LANGUAGES))) {
    const t = r.byLanguage[lang]
    if (t) log(`Magic ${lang}: ${t.cards} cards, ${t.printings} printings (${t.priced} priced)`)
  }
  for (const s of r.perSet) {
    if (s.printings > 0 && s.priced * 100 < LOW_SHARE_PERCENT * s.printings)
      log(`Magic en ${s.setCode}: ${s.priced}/${s.printings} priced`)
  }
  for (const n of r.notes) log(`Magic en: ${n}`)
}
