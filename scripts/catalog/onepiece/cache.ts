import Database from 'better-sqlite3'
import { HASH_WORDS } from '../../../src/shared/scan/fingerprint'
import type { BandaiEntry, BandaiSeries } from './types'

/** An artHash's 8 words as 64 lowercase hex characters (8 per word). */
export function hashToHex(words: Uint32Array): string {
  let s = ''
  for (let i = 0; i < HASH_WORDS; i++) s += (words[i] >>> 0).toString(16).padStart(8, '0')
  return s
}

export function hexToHash(hex: string): Uint32Array {
  const out = new Uint32Array(HASH_WORDS)
  for (let i = 0; i < HASH_WORDS; i++) out[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16)
  return out
}

export interface SeriesRow {
  series: BandaiSeries
  firstSeenAt: number
  fetchedAt: number | null
  /** When a short parse of the page was first raised; null once a page parses in full again. */
  shrinkNotedAt: number | null
}
export interface BandaiArtRow {
  bandaiId: string
  /** 64 hex characters. */
  hash: string
  lastModified: string | null
  checkedAt: number
  storedAt: number | null
  changedHash: string | null
  notedAt: number | null
  /** When the portal last refused the art as too large (or no small copy fit); null otherwise. */
  tooLargeAt: number | null
}
export interface TcgArtRow { productId: number; imageUrl: string; hash: string; fetchedAt: number }
export interface SetStatsRow { setCode: string; printings: number; priced: number }

export interface OpCache {
  getSeries(id: string): SeriesRow | null
  /** Inserts a new series row (first_seen_at = now), or refreshes the stored json of an existing one. */
  putSeries(s: BandaiSeries, now: number): void
  markFetched(id: string, at: number): void
  /** Stamps (or, with null, clears) the night a short parse of the series' page was first raised. */
  markShrink(id: string, at: number | null): void

  getEntries(seriesId: string): BandaiEntry[]
  /** Replaces a series' entries; a (series, id) already stored keeps its first_seen_at. */
  replaceEntries(seriesId: string, entries: BandaiEntry[], now: number): void
  /** The earliest time any series stored this Bandai id, or null. */
  firstSeenAt(bandaiId: string): number | null
  /** firstSeenAt of every stored Bandai id, in one query. */
  firstSeenAll(): Map<string, number>

  getBandaiArt(bandaiId: string): BandaiArtRow | null
  putBandaiArt(row: BandaiArtRow): void
  getTcgArt(productId: number): TcgArtRow | null
  putTcgArt(row: TcgArtRow): void
  getSetStats(setCode: string): SetStatsRow | null
  putSetStats(row: SetStatsRow): void
  /** TCGCSV groups that failed on the last night they were tried, to when that run of failures began. */
  failingGroups(): Map<number, number>
  /** Replaces the failing groups with tonight's (an empty map clears them). */
  setFailingGroups(groups: Map<number, number>): void
  close(): void
}

export function openOpCache(path: string): OpCache {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS series (id TEXT PRIMARY KEY, json TEXT NOT NULL, first_seen_at INTEGER NOT NULL, fetched_at INTEGER);
    CREATE TABLE IF NOT EXISTS entries (series_id TEXT NOT NULL, bandai_id TEXT NOT NULL, json TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL, PRIMARY KEY (series_id, bandai_id));
    CREATE TABLE IF NOT EXISTS bandai_art (bandai_id TEXT PRIMARY KEY, hash TEXT NOT NULL, last_modified TEXT,
      checked_at INTEGER NOT NULL, stored_at INTEGER, changed_hash TEXT, noted_at INTEGER);
    CREATE TABLE IF NOT EXISTS tcg_art (product_id INTEGER PRIMARY KEY, image_url TEXT NOT NULL, hash TEXT NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS set_stats (set_code TEXT PRIMARY KEY, printings INTEGER NOT NULL, priced INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS failing_groups (group_id INTEGER PRIMARY KEY, since INTEGER NOT NULL);
  `)
  // Columns added after the first cache files were made.
  const addColumn = (table: string, column: string): void => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER`)
  }
  addColumn('series', 'shrink_noted_at')
  addColumn('bandai_art', 'too_large_at')
  const selSeries = db.prepare('SELECT json, first_seen_at, fetched_at, shrink_noted_at FROM series WHERE id = ?')
  const insSeries = db.prepare(
    'INSERT INTO series (id, json, first_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json'
  )
  const setFetched = db.prepare('UPDATE series SET fetched_at = ? WHERE id = ?')
  const setShrink = db.prepare('UPDATE series SET shrink_noted_at = ? WHERE id = ?')
  const selEntries = db.prepare('SELECT json FROM entries WHERE series_id = ? ORDER BY rowid')
  const selEntryTimes = db.prepare('SELECT bandai_id, first_seen_at FROM entries WHERE series_id = ?')
  const delEntries = db.prepare('DELETE FROM entries WHERE series_id = ?')
  const insEntry = db.prepare('INSERT OR IGNORE INTO entries (series_id, bandai_id, json, first_seen_at) VALUES (?, ?, ?, ?)')
  const minSeen = db.prepare('SELECT MIN(first_seen_at) AS t FROM entries WHERE bandai_id = ?')
  const allSeen = db.prepare('SELECT bandai_id, MIN(first_seen_at) AS t FROM entries GROUP BY bandai_id')
  const selArt = db.prepare('SELECT * FROM bandai_art WHERE bandai_id = ?')
  const insArt = db.prepare(
    'INSERT OR REPLACE INTO bandai_art (bandai_id, hash, last_modified, checked_at, stored_at, changed_hash, noted_at, too_large_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const selTcg = db.prepare('SELECT * FROM tcg_art WHERE product_id = ?')
  const insTcg = db.prepare('INSERT OR REPLACE INTO tcg_art (product_id, image_url, hash, fetched_at) VALUES (?, ?, ?, ?)')
  const selStats = db.prepare('SELECT * FROM set_stats WHERE set_code = ?')
  const insStats = db.prepare('INSERT OR REPLACE INTO set_stats (set_code, printings, priced) VALUES (?, ?, ?)')
  const selFailing = db.prepare('SELECT group_id, since FROM failing_groups')
  const insFailing = db.prepare('INSERT INTO failing_groups (group_id, since) VALUES (?, ?)')
  const setFailing = db.transaction((groups: Map<number, number>) => {
    db.exec('DELETE FROM failing_groups')
    for (const [id, since] of groups) insFailing.run(id, since)
  })
  const replace = db.transaction((seriesId: string, entries: BandaiEntry[], now: number) => {
    const seen = new Map((selEntryTimes.all(seriesId) as { bandai_id: string; first_seen_at: number }[]).map((r) => [r.bandai_id, r.first_seen_at]))
    delEntries.run(seriesId)
    for (const e of entries) {
      insEntry.run(seriesId, e.bandaiId, JSON.stringify(e), seen.get(e.bandaiId) ?? now)
    }
  })
  return {
    getSeries(id) {
      const r = selSeries.get(id) as
        | { json: string; first_seen_at: number; fetched_at: number | null; shrink_noted_at: number | null }
        | undefined
      return r
        ? {
            series: JSON.parse(r.json) as BandaiSeries, firstSeenAt: r.first_seen_at, fetchedAt: r.fetched_at,
            shrinkNotedAt: r.shrink_noted_at
          }
        : null
    },
    putSeries(s, now) { insSeries.run(s.id, JSON.stringify(s), now) },
    markFetched(id, at) { setFetched.run(at, id) },
    markShrink(id, at) { setShrink.run(at, id) },
    getEntries(seriesId) {
      return (selEntries.all(seriesId) as { json: string }[]).map((r) => JSON.parse(r.json) as BandaiEntry)
    },
    replaceEntries(seriesId, entries, now) { replace(seriesId, entries, now) },
    firstSeenAt(bandaiId) {
      return (minSeen.get(bandaiId) as { t: number | null }).t
    },
    firstSeenAll() {
      return new Map((allSeen.all() as { bandai_id: string; t: number }[]).map((r) => [r.bandai_id, r.t]))
    },
    getBandaiArt(id) {
      const r = selArt.get(id) as Record<string, unknown> | undefined
      return r
        ? {
            bandaiId: r.bandai_id as string, hash: r.hash as string, lastModified: r.last_modified as string | null,
            checkedAt: r.checked_at as number, storedAt: r.stored_at as number | null,
            changedHash: r.changed_hash as string | null, notedAt: r.noted_at as number | null,
            tooLargeAt: r.too_large_at as number | null
          }
        : null
    },
    putBandaiArt(a) {
      insArt.run(a.bandaiId, a.hash, a.lastModified, a.checkedAt, a.storedAt, a.changedHash, a.notedAt, a.tooLargeAt)
    },
    getTcgArt(id) {
      const r = selTcg.get(id) as { product_id: number; image_url: string; hash: string; fetched_at: number } | undefined
      return r ? { productId: r.product_id, imageUrl: r.image_url, hash: r.hash, fetchedAt: r.fetched_at } : null
    },
    putTcgArt(a) { insTcg.run(a.productId, a.imageUrl, a.hash, a.fetchedAt) },
    getSetStats(code) {
      const r = selStats.get(code) as { set_code: string; printings: number; priced: number } | undefined
      return r ? { setCode: r.set_code, printings: r.printings, priced: r.priced } : null
    },
    putSetStats(s) { insStats.run(s.setCode, s.printings, s.priced) },
    failingGroups() {
      return new Map((selFailing.all() as { group_id: number; since: number }[]).map((r) => [r.group_id, r.since]))
    },
    setFailingGroups(groups) { setFailing(groups) },
    close() { db.close() }
  }
}
