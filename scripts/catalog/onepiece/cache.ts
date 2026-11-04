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

export interface SeriesRow { series: BandaiSeries; firstSeenAt: number; fetchedAt: number | null }
export interface BandaiArtRow {
  bandaiId: string
  /** 64 hex characters. */
  hash: string
  lastModified: string | null
  checkedAt: number
  storedAt: number | null
  changedHash: string | null
  notedAt: number | null
}
export interface TcgArtRow { productId: number; imageUrl: string; hash: string; fetchedAt: number }
export interface SetStatsRow { setCode: string; printings: number; priced: number }

export interface OpCache {
  getSeries(id: string): SeriesRow | null
  /** Inserts a new series row (first_seen_at = now), or refreshes the stored json of an existing one. */
  putSeries(s: BandaiSeries, now: number): void
  markFetched(id: string, at: number): void

  getEntries(seriesId: string): BandaiEntry[]
  /** Replaces a series' entries; a (series, id) already stored keeps its first_seen_at. */
  replaceEntries(seriesId: string, entries: BandaiEntry[], now: number): void
  /** The earliest time any series stored this Bandai id, or null. */
  firstSeenAt(bandaiId: string): number | null

  getBandaiArt(bandaiId: string): BandaiArtRow | null
  putBandaiArt(row: BandaiArtRow): void
  getTcgArt(productId: number): TcgArtRow | null
  putTcgArt(row: TcgArtRow): void
  getSetStats(setCode: string): SetStatsRow | null
  putSetStats(row: SetStatsRow): void
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
  `)
  const selSeries = db.prepare('SELECT json, first_seen_at, fetched_at FROM series WHERE id = ?')
  const insSeries = db.prepare(
    'INSERT INTO series (id, json, first_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json'
  )
  const setFetched = db.prepare('UPDATE series SET fetched_at = ? WHERE id = ?')
  const selEntries = db.prepare('SELECT json FROM entries WHERE series_id = ? ORDER BY rowid')
  const selEntryTimes = db.prepare('SELECT bandai_id, first_seen_at FROM entries WHERE series_id = ?')
  const delEntries = db.prepare('DELETE FROM entries WHERE series_id = ?')
  const insEntry = db.prepare('INSERT OR IGNORE INTO entries (series_id, bandai_id, json, first_seen_at) VALUES (?, ?, ?, ?)')
  const minSeen = db.prepare('SELECT MIN(first_seen_at) AS t FROM entries WHERE bandai_id = ?')
  const selArt = db.prepare('SELECT * FROM bandai_art WHERE bandai_id = ?')
  const insArt = db.prepare(
    'INSERT OR REPLACE INTO bandai_art (bandai_id, hash, last_modified, checked_at, stored_at, changed_hash, noted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const selTcg = db.prepare('SELECT * FROM tcg_art WHERE product_id = ?')
  const insTcg = db.prepare('INSERT OR REPLACE INTO tcg_art (product_id, image_url, hash, fetched_at) VALUES (?, ?, ?, ?)')
  const selStats = db.prepare('SELECT * FROM set_stats WHERE set_code = ?')
  const insStats = db.prepare('INSERT OR REPLACE INTO set_stats (set_code, printings, priced) VALUES (?, ?, ?)')
  const replace = db.transaction((seriesId: string, entries: BandaiEntry[], now: number) => {
    const seen = new Map((selEntryTimes.all(seriesId) as { bandai_id: string; first_seen_at: number }[]).map((r) => [r.bandai_id, r.first_seen_at]))
    delEntries.run(seriesId)
    for (const e of entries) {
      insEntry.run(seriesId, e.bandaiId, JSON.stringify(e), seen.get(e.bandaiId) ?? now)
    }
  })
  return {
    getSeries(id) {
      const r = selSeries.get(id) as { json: string; first_seen_at: number; fetched_at: number | null } | undefined
      return r ? { series: JSON.parse(r.json) as BandaiSeries, firstSeenAt: r.first_seen_at, fetchedAt: r.fetched_at } : null
    },
    putSeries(s, now) { insSeries.run(s.id, JSON.stringify(s), now) },
    markFetched(id, at) { setFetched.run(at, id) },
    getEntries(seriesId) {
      return (selEntries.all(seriesId) as { json: string }[]).map((r) => JSON.parse(r.json) as BandaiEntry)
    },
    replaceEntries(seriesId, entries, now) { replace(seriesId, entries, now) },
    firstSeenAt(bandaiId) {
      return (minSeen.get(bandaiId) as { t: number | null }).t
    },
    getBandaiArt(id) {
      const r = selArt.get(id) as Record<string, unknown> | undefined
      return r
        ? {
            bandaiId: r.bandai_id as string, hash: r.hash as string, lastModified: r.last_modified as string | null,
            checkedAt: r.checked_at as number, storedAt: r.stored_at as number | null,
            changedHash: r.changed_hash as string | null, notedAt: r.noted_at as number | null
          }
        : null
    },
    putBandaiArt(a) {
      insArt.run(a.bandaiId, a.hash, a.lastModified, a.checkedAt, a.storedAt, a.changedHash, a.notedAt)
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
    close() { db.close() }
  }
}
