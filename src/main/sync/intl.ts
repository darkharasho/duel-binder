import type Database from 'better-sqlite3'
import { languageForSuffix, type Language } from '@shared/languages'
import { yugipediaImageKey } from '../images/cache'
import { getMeta, setMeta } from '../db/meta'
import type { YugipediaClient } from '../yugipedia/client'
import {
  listTitleParts,
  MANGA_STYLE,
  MANGA_TONES,
  NEW_ART_VARIANT,
  normalizeRarity,
  parseInfobox,
  parseSetList,
  releaseDateFor,
  type ParsedSetList,
  type SetListRow
} from '../yugipedia/parse'

export const INTL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const CHUNK_SIZE = 50
/**
 * Least time between onBatch calls after the first. Each one has the UI refetch its set and
 * collection queries, which holds up the main process for most of a second.
 */
export const BATCH_NOTE_MS = 30_000
const MAX_LOGGED_UNMATCHED = 20
const LANGUAGE_PRIORITY: readonly Language[] = ['ja', 'ko', 'zh-hans', 'zh-hant']

export interface IntlSyncResult {
  sets: number
  failedSets: number
  unmatchedRows: number
  ok: boolean
}

export function shouldRefreshIntl(db: Database.Database, now: Date): boolean {
  const last = getMeta(db, 'intl_sets_synced_at')
  if (!last) return true
  const t = Date.parse(last)
  return Number.isNaN(t) || now.getTime() - t >= INTL_INTERVAL_MS
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

interface SetJob {
  title: string
  setName: string
  language: Language
}

interface LoadedSet extends SetJob {
  parsed: ParsedSetList
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Pages by requested title; a failed chunk is left out and reported through `failed`. */
async function fetchChunked(
  client: YugipediaClient,
  titles: string[]
): Promise<{ pages: Map<string, string>; failed: Set<string> }> {
  const pages = new Map<string, string>()
  const failed = new Set<string>()
  for (const part of chunk(titles, CHUNK_SIZE)) {
    try {
      for (const [t, text] of await client.fetchPages(part)) pages.set(t, text)
    } catch (e) {
      console.warn('Yugipedia page fetch failed:', e instanceof Error ? e.message : String(e))
      for (const t of part) failed.add(t)
    }
  }
  return { pages, failed }
}

/** Rows not seen this run: delete when no entry references them, else flag as missing. */
function deleteOrFlag(db: Database.Database, ids: number[]): void {
  const del = db.prepare(
    `DELETE FROM card_printings WHERE id = ? AND NOT EXISTS
       (SELECT 1 FROM collection_entries WHERE printing_id = card_printings.id)`
  )
  const flag = db.prepare('UPDATE card_printings SET missing_from_api = 1 WHERE id = ?')
  for (const id of ids) {
    del.run(id)
    flag.run(id) // no-op for rows already deleted
  }
}

interface IntlPrinting {
  cardId: number
  setCode: string
  setRarity: string
  variant: string | null
}

/**
 * One printing per row and rarity, keyed like the English art variants: a variant whose code and
 * rarity a plain row also has becomes "<rarity> (<variant>)" (an overframe Ultra Rare beside the
 * plain one); otherwise it keeps the bare rarity with the variant in `variant` (an overframe-only
 * Prismatic Secret Rare), so a printing stored before variants were read keeps its row. A plain row
 * the list marks "New artwork" keeps its bare rarity too, with NEW_ART_VARIANT in `variant`, so its
 * printing scan is fingerprinted (YGOPRODeck only has the old art). A Manga-Style row stands for
 * its Color and Monochrome printings: "Ultra Rare" with the variant "Manga-Style, Color" and
 * "Ultra Rare (Manga-Style, Monochrome)".
 */
function listPrintings(matched: { cardId: number; row: SetListRow }[]): IntlPrinting[] {
  const out: IntlPrinting[] = []
  const taken = new Set<string>()
  const add = (p: IntlPrinting): void => {
    const key = `${p.cardId}\u0000${p.setCode}\u0000${p.setRarity}`
    if (taken.has(key)) return
    taken.add(key)
    out.push(p)
  }
  // Plain rows first, so they claim the bare rarity before any variant does.
  for (const { cardId, row } of matched) {
    if (row.variant) continue
    const variant = row.newArt ? NEW_ART_VARIANT : null
    for (const r of row.rarities)
      add({ cardId, setCode: row.code, setRarity: normalizeRarity(r), variant })
  }
  // A Manga-Style row is two printings of each rarity, Color and Monochrome; Color goes first,
  // so it keeps the bare rarity a Manga-Style printing was stored under before they were told
  // apart (and the entries on it, whose art the app showed in colour).
  const tone = (v: string): number => (v.endsWith(`, ${MANGA_TONES[1]}`) ? 1 : 0)
  const variants = matched
    .flatMap(({ cardId, row }) =>
      row.variant === MANGA_STYLE
        ? MANGA_TONES.map((t) => ({ cardId, row, variant: `${MANGA_STYLE}, ${t}` }))
        : row.variant
          ? [{ cardId, row, variant: row.variant }]
          : []
    )
    .sort((a, b) => tone(a.variant) - tone(b.variant))
  for (const { cardId, row, variant } of variants) {
    for (const r of row.rarities) {
      const rarity = normalizeRarity(r)
      const bare = `${cardId}\u0000${row.code}\u0000${rarity}`
      if (taken.has(bare))
        add({ cardId, setCode: row.code, setRarity: `${rarity} (${variant})`, variant: null })
      else add({ cardId, setCode: row.code, setRarity: rarity, variant })
    }
  }
  return out
}

/** Never rejects. Non-English rows are written only here; English rows are never touched. */
export async function refreshIntlSets(
  db: Database.Database,
  client: YugipediaClient,
  now: Date = new Date(),
  /** Called after the first saved batch of sets, then at most every BATCH_NOTE_MS (e.g. to refresh the UI). */
  onBatch?: () => void,
  clock: () => number = Date.now
): Promise<IntlSyncResult> {
  const result: IntlSyncResult = { sets: 0, failedSets: 0, unmatchedRows: 0, ok: false }
  try {
    return await run(db, client, now, result, onBatch, clock)
  } catch (e) {
    console.warn('Non-English set sync failed', e)
    result.ok = false
    return result
  }
}

async function run(
  db: Database.Database,
  client: YugipediaClient,
  now: Date,
  result: IntlSyncResult,
  onBatch: (() => void) | undefined,
  clock: () => number
): Promise<IntlSyncResult> {
  let allTitles: string[]
  console.info('Yugipedia: listing set lists')
  try {
    allTitles = await client.listSetListTitles()
  } catch (e) {
    console.warn('Yugipedia set listing failed', e)
    return result
  }

  const jobs: SetJob[] = []
  for (const title of allTitles) {
    const parts = listTitleParts(title)
    const language = parts ? languageForSuffix(parts.suffix) : null
    if (parts && language && language !== 'en')
      jobs.push({ title, setName: parts.setName, language })
  }
  // An empty listing would otherwise look like "every set vanished".
  if (jobs.length === 0) {
    console.warn('Yugipedia listed no non-English sets; keeping existing data')
    return result
  }
  result.sets = jobs.length
  console.info(`Yugipedia: ${jobs.length} non-English set lists to sync`)

  const cardIds = new Map<string, number>()
  const cardRows = db
    .prepare("SELECT id, name FROM cards WHERE game = 'ygo' ORDER BY id")
    .all() as {
    id: number
    name: string
  }[]
  for (const c of cardRows) {
    const key = normalizeName(c.name)
    if (!cardIds.has(key)) cardIds.set(key, c.id)
  }

  const upsertPrinting = db.prepare(`
    INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity, set_rarity_code, set_price,
      missing_from_api, variant)
    VALUES (@cardId, @language, @setName, @setCode, @setRarity, '', NULL, 0, @variant)
    ON CONFLICT(card_id, language, set_name, set_code, set_rarity) WHERE language <> 'en'
      DO UPDATE SET missing_from_api = 0, variant = excluded.variant
    RETURNING id`)
  const upsertSet = db.prepare(`
    INSERT INTO sets (language, set_name, set_code, tcg_date, image_url, image_key, list_rows, unmatched_rows)
    VALUES (@language, @setName, '', @tcgDate, @imageUrl, @imageKey, @listRows, @unmatchedRows)
    ON CONFLICT(game, language, set_name) DO UPDATE SET set_code = '',
      tcg_date = CASE WHEN @keepDate THEN sets.tcg_date ELSE excluded.tcg_date END,
      image_url = CASE WHEN @keepImage THEN sets.image_url ELSE excluded.image_url END,
      image_key = CASE WHEN @keepImage THEN sets.image_key ELSE excluded.image_key END, list_rows = excluded.list_rows, unmatched_rows = excluded.unmatched_rows`)
  const existing = db.prepare(
    "SELECT id FROM card_printings WHERE game = 'ygo' AND language = ? AND set_name = ?"
  )

  const unmatchedExamples: string[] = []
  const seenSets = new Set<string>()

  // Sets not stored yet go first, so an interrupted first sync fills in rather than starting over;
  // within that, sets with no English release (e.g. Limit Over Collection) first, then Asian-market
  // lists before European ones.
  const storedSet = db.prepare(
    "SELECT 1 FROM sets WHERE game = 'ygo' AND language = ? AND set_name = ?"
  )
  const englishSets = new Set(
    (
      db
        .prepare(
          "SELECT DISTINCT set_name FROM card_printings WHERE game = 'ygo' AND language = 'en'"
        )
        .all() as {
        set_name: string
      }[]
    ).map((r) => r.set_name.toLowerCase())
  )
  const priority = (j: SetJob): number => {
    const i = LANGUAGE_PRIORITY.indexOf(j.language)
    const lang = i === -1 ? LANGUAGE_PRIORITY.length : i
    return (englishSets.has(j.setName.toLowerCase()) ? LANGUAGE_PRIORITY.length + 1 : 0) + lang
  }
  const byPriority = (a: SetJob, b: SetJob): number => priority(a) - priority(b)
  const ordered = [
    ...jobs.filter((j) => !storedSet.get(j.language, j.setName)).sort(byPriority),
    ...jobs.filter((j) => storedSet.get(j.language, j.setName))
  ]
  let saved = 0
  let notedAt: number | null = null
  // Each batch is fetched, parsed and saved on its own, so progress survives a quit mid-sync.
  for (const batch of chunk(ordered, CHUNK_SIZE)) {
    const listFetch = await fetchChunked(
      client,
      batch.map((j) => j.title)
    )
    const loaded: LoadedSet[] = []
    for (const job of batch) {
      const text = listFetch.pages.get(job.title)
      const parsed = text === undefined ? null : parseSetList(text)
      if (parsed) loaded.push({ ...job, parsed })
      else result.failedSets++
    }

    const pageTitle = (s: LoadedSet): string => s.parsed.setPage ?? s.setName
    const infoFetch = await fetchChunked(client, [...new Set(loaded.map(pageTitle))])
    const infoboxes = new Map(
      loaded.map((s) => {
        const text = infoFetch.pages.get(pageTitle(s))
        return [s.title, text === undefined ? null : parseInfobox(text)] as const
      })
    )
    const files = [...new Set([...infoboxes.values()].flatMap((b) => (b?.image ? [b.image] : [])))]
    let imageUrls = new Map<string, string>()
    let imagesFailed = false
    if (files.length > 0) {
      try {
        imageUrls = await client.fetchImageUrls(files)
      } catch {
        imagesFailed = true // images are optional; keep what is stored
      }
    }

    for (const s of loaded) {
      let unmatched = 0
      const matched: { cardId: number; row: SetListRow }[] = []
      for (const row of s.parsed.rows) {
        const key = normalizeName(row.name)
        // Yugipedia titles some card pages "Name (card)"; only that suffix is dropped.
        const cardId = cardIds.get(key) ?? cardIds.get(key.replace(/ \(card\)$/, ''))
        if (cardId === undefined) {
          unmatched++
          if (unmatchedExamples.length < MAX_LOGGED_UNMATCHED) unmatchedExamples.push(row.name)
          continue
        }
        matched.push({ cardId, row })
      }
      result.unmatchedRows += unmatched
      const printings = listPrintings(matched)

      const box = infoboxes.get(s.title) ?? null
      const imageUrl = box?.image ? (imageUrls.get(box.image) ?? null) : null
      db.transaction(() => {
        const seen = new Set<number>()
        for (const p of printings) {
          const row = upsertPrinting.get({
            ...p,
            language: s.language,
            setName: s.setName
          }) as { id: number }
          seen.add(row.id)
        }
        const stale = (existing.all(s.language, s.setName) as { id: number }[])
          .map((r) => r.id)
          .filter((id) => !seen.has(id))
        deleteOrFlag(db, stale)
        upsertSet.run({
          language: s.language,
          setName: s.setName,
          tcgDate: box ? releaseDateFor(box, s.language) : null,
          imageUrl,
          listRows: s.parsed.rows.length,
          unmatchedRows: unmatched,
          imageKey: yugipediaImageKey(imageUrl),
          keepDate: box ? 0 : 1,
          keepImage: !box || imagesFailed ? 1 : 0
        })
      })()
      seenSets.add(`${s.language}\u0000${s.setName}`)
    }

    saved += loaded.length
    console.info(`Yugipedia: saved ${saved} of ${jobs.length} set lists`)
    if (onBatch && (notedAt === null || clock() - notedAt >= BATCH_NOTE_MS)) {
      notedAt = clock()
      onBatch()
    }
  }

  if (unmatchedExamples.length > 0) {
    console.info(
      `Yugipedia: ${result.unmatchedRows} unmatched rows; examples: ${unmatchedExamples.join(', ')}`
    )
  }

  result.ok = result.failedSets === 0
  if (result.ok) {
    // Only languages in this run's listing: another language may simply not be listed right now.
    const langs = [...new Set(jobs.map((j) => j.language))]
    const inLangs = `game = 'ygo' AND language IN (${langs.map(() => '?').join(', ')})`
    db.transaction(() => {
      const gone = (
        db.prepare(`SELECT language, set_name FROM sets WHERE ${inLangs}`).all(...langs) as {
          language: string
          set_name: string
        }[]
      ).filter((r) => !seenSets.has(`${r.language}\u0000${r.set_name}`))
      const orphanPrintings = (
        db
          .prepare(`SELECT id, language, set_name FROM card_printings WHERE ${inLangs}`)
          .all(...langs) as { id: number; language: string; set_name: string }[]
      ).filter((r) => !seenSets.has(`${r.language}\u0000${r.set_name}`))
      deleteOrFlag(
        db,
        orphanPrintings.map((r) => r.id)
      )
      const delSet = db.prepare(
        "DELETE FROM sets WHERE game = 'ygo' AND language = ? AND set_name = ?"
      )
      for (const r of gone) delSet.run(r.language, r.set_name)
      setMeta(db, 'intl_sets_synced_at', now.toISOString())
    })()
  }
  return result
}
