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
  onlyTranscludesLists,
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
export function deleteOrFlag(db: Database.Database, ids: number[]): void {
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

interface StoredPrinting {
  id: number
  card_id: number
  set_code: string
  set_rarity: string
}

/** A stored rarity with a leading abbreviation spelled out: "PlScR (7th artwork)" -> "Platinum Secret Rare (7th artwork)". */
function spelledOut(rarity: string): string {
  const m = /^([A-Za-z0-9]+)( \(.+\))?$/.exec(rarity)
  return m ? normalizeRarity(m[1]) + (m[2] ?? '') : rarity
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

/**
 * The English printings from the TCG-EN lists that YGOPRODeck lacks (MGED-EN002, the alternate-art
 * Dark Magician, which it leaves off the card). YGOPRODeck stays the authority: a list row is
 * skipped when a YGOPRODeck, TCGplayer or token printing already holds its code, whatever the card
 * or rarity (rarity spellings, YGOPRODeck's junk rarities like "New" and its reprint sets would
 * otherwise each give the same printing twice; its other rarities are TCGplayer's to add), when
 * another list row this run gave the code to another card, or when it has no code or a
 * placeholder one ("MAMS-EN???"). Each row is written once a run, by the first list holding it, under
 * the set name YGOPRODeck gives the set: the one with the list's name, else the one most of the
 * code's siblings (MGED-EN001...) are in, else the list's name. Rows are marked
 * card_printings.yugipedia, which keeps the YGOPRODeck sync from pruning them and lets it take one
 * over (same id, so entries stay) when it lists the printing. Token cards are left to the token sync.
 */
function englishFill(db: Database.Database): {
  save: (setName: string, matched: { cardId: number; row: SetListRow }[]) => void
  /** Drops (or flags, when owned) the filled rows no list held this run. */
  prune: () => void
} {
  const stem = (code: string): string => code.toUpperCase().replace(/\d+$/, '')

  const tokens = new Set(
    db.prepare("SELECT id FROM cards WHERE game = 'ygo' AND frame_type = 'token'").pluck().all()
  )
  /** Codes YGOPRODeck, TCGplayer or the token sync hold. */
  const taken = new Set<string>()
  /** The card each code went to this run. */
  const holders = new Map<string, number>()
  const stemSets = new Map<string, Map<string, number>>()
  const setNames = new Map<string, string>()
  const others = db
    .prepare(
      `SELECT card_id, set_name, set_code, set_rarity FROM card_printings
       WHERE game = 'ygo' AND language = 'en' AND yugipedia = 0 AND set_code <> ''`
    )
    .all() as { card_id: number; set_name: string; set_code: string; set_rarity: string }[]
  for (const r of others) {
    const code = r.set_code.toUpperCase()
    taken.add(code)
    const names = stemSets.get(stem(code)) ?? new Map<string, number>()
    stemSets.set(stem(code), names.set(r.set_name, (names.get(r.set_name) ?? 0) + 1))
    const norm = normalizeName(r.set_name)
    if (!setNames.has(norm)) setNames.set(norm, r.set_name)
  }
  for (const name of db
    .prepare("SELECT set_name FROM sets WHERE game = 'ygo' AND language = 'en' ORDER BY set_name")
    .pluck()
    .all() as string[]) {
    if (!setNames.has(normalizeName(name))) setNames.set(normalizeName(name), name)
  }
  /** YGOPRODeck's name for the set most of a stem's printings are in (ties: first by name). */
  const stemName = (code: string): string | undefined =>
    [...(stemSets.get(stem(code)) ?? [])].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)
    )[0]?.[0]
  // The rarity code YGOPRODeck gives each rarity most often, as on its own rows.
  const rarityCodes = new Map(
    (
      db
        .prepare(
          `SELECT set_rarity, set_rarity_code FROM card_printings
           WHERE game = 'ygo' AND language = 'en' AND yugipedia = 0 AND set_rarity_code <> ''
           GROUP BY set_rarity, set_rarity_code ORDER BY count(*)`
        )
        .all() as { set_rarity: string; set_rarity_code: string }[]
    ).map((r) => [r.set_rarity, r.set_rarity_code])
  )

  const upsert = db.prepare(`
    INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity, set_rarity_code, set_price,
      missing_from_api, variant, yugipedia)
    VALUES (@cardId, 'en', @setName, @setCode, @setRarity, @rarityCode, NULL, 0, @variant, 1)
    ON CONFLICT(card_id, set_code, set_rarity) WHERE language = 'en'
      DO UPDATE SET set_name = excluded.set_name, set_rarity_code = excluded.set_rarity_code,
        missing_from_api = 0, variant = excluded.variant
      WHERE card_printings.yugipedia = 1
    RETURNING id`)
  const written = new Set<string>()
  const seen = new Set<number>()

  return {
    save(setName, matched) {
      const printings = listPrintings(matched.filter((m) => !tokens.has(m.cardId)))
      for (const p of printings) {
        const code = p.setCode.toUpperCase()
        if (code === '' || code.includes('?') || taken.has(code)) continue
        if ((holders.get(code) ?? p.cardId) !== p.cardId) continue
        const once = `${p.cardId}\u0000${code}\u0000${p.setRarity}`
        if (written.has(once)) continue
        written.add(once)
        holders.set(code, p.cardId)
        const row = upsert.get({
          ...p,
          setName: setNames.get(normalizeName(setName)) ?? stemName(code) ?? setName,
          rarityCode: rarityCodes.get(p.setRarity) ?? ''
        }) as { id: number } | undefined
        if (row) seen.add(row.id)
      }
    },
    prune() {
      const ids = db
        .prepare(
          "SELECT id FROM card_printings WHERE game = 'ygo' AND language = 'en' AND yugipedia = 1"
        )
        .pluck()
        .all() as number[]
      deleteOrFlag(
        db,
        ids.filter((id) => !seen.has(id))
      )
    }
  }
}

/**
 * Never rejects. Non-English rows are written only here. English rows come from YGOPRODeck; of
 * them this writes only the ones YGOPRODeck lacks (see englishFill) and never touches the rest.
 */
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
    console.warn('Yugipedia set list sync failed', e)
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
    if (parts && language) jobs.push({ title, setName: parts.setName, language })
  }
  // An empty listing would otherwise look like "every set vanished".
  if (jobs.length === 0) {
    console.warn('Yugipedia listed no sets; keeping existing data')
    return result
  }
  result.sets = jobs.length
  console.info(`Yugipedia: ${jobs.length} set lists to sync`)

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
    `SELECT id, card_id, set_code, set_rarity FROM card_printings
     WHERE game = 'ygo' AND language = ? AND set_name = ?`
  )
  const keepAbbreviated = db.prepare(
    'UPDATE card_printings SET missing_from_api = 0, variant = ? WHERE id = ?'
  )

  const unmatchedExamples: string[] = []
  const seenSets = new Set<string>()
  const english = englishFill(db)

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
      // Its subpages are listed on their own; counting it failed would keep the sync from ever
      // finishing (no stamp, so a full re-read every run, and nothing pruned).
      else if (text !== undefined && onlyTranscludesLists(text)) continue
      else result.failedSets++
    }

    const pageTitle = (s: LoadedSet): string => s.parsed.setPage ?? s.setName
    // English sets' dates and images are YGOPRODeck's, so their set pages aren't read.
    const boxed = loaded.filter((s) => s.language !== 'en')
    const infoFetch = await fetchChunked(client, [...new Set(boxed.map(pageTitle))])
    const infoboxes = new Map(
      boxed.map((s) => {
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
      if (s.language === 'en') {
        // English sets are YGOPRODeck's (sync/sets.ts); only the missing printings are added.
        db.transaction(() => english.save(s.setName, matched))()
        continue
      }
      const printings = listPrintings(matched)

      const box = infoboxes.get(s.title) ?? null
      const imageUrl = box?.image ? (imageUrls.get(box.image) ?? null) : null
      db.transaction(() => {
        const stored = existing.all(s.language, s.setName) as StoredPrinting[]
        const key = (cardId: number, code: string, rarity: string): string =>
          `${cardId}\u0000${code}\u0000${rarity}`
        const exact = new Set(stored.map((r) => key(r.card_id, r.set_code, r.set_rarity)))
        // A printing stored under a rarity abbreviation since spelled out ("PlScR") keeps its
        // spelling: renaming it changes its pkey, which the catalog feed and cloud sync carry as a
        // removed printing and a new one, leaving its entries on a flagged row.
        const abbreviated = new Map(
          stored
            .filter((r) => spelledOut(r.set_rarity) !== r.set_rarity)
            .map((r) => [key(r.card_id, r.set_code, spelledOut(r.set_rarity)), r.id])
        )
        const seen = new Set<number>()
        for (const p of printings) {
          const k = key(p.cardId, p.setCode, p.setRarity)
          const old = exact.has(k) ? undefined : abbreviated.get(k)
          if (old !== undefined) {
            keepAbbreviated.run(p.variant, old)
            seen.add(old)
            continue
          }
          const row = upsertPrinting.get({
            ...p,
            language: s.language,
            setName: s.setName
          }) as { id: number }
          seen.add(row.id)
        }
        const stale = stored.map((r) => r.id).filter((id) => !seen.has(id))
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
    const langs = [...new Set(jobs.map((j) => j.language))].filter((l) => l !== 'en')
    const inLangs = `game = 'ygo' AND language IN (${langs.map(() => '?').join(', ')})`
    db.transaction(() => {
      if (jobs.some((j) => j.language === 'en')) english.prune()
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
