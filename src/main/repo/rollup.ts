import type { SqlDb } from '../db/sql'

/**
 * `compute()`'s result, stored under `key` until the catalog changes (the triggers of SCHEMA_V47
 * drop a game's rollups when its catalog rows change, and every rollup when a shared table does;
 * the portal's server-44 does the same). `game` is the game the result is about. Only for results
 * that the catalog alone decides: anything about the collection must be read live. The store is a
 * cache, so a failed read or write just computes.
 */
export function catalogRollup<T>(db: SqlDb, key: string, game: string, compute: () => T): T {
  const stored = readRollup<T>(db, key)
  if (stored !== undefined) return stored
  const value = compute()
  storeRollup(db, key, game, value)
  return value
}

/**
 * The most JSON text one row holds. The portal's Durable Object SQLite refuses a value over 2 MB,
 * and Yu-Gi-Oh!'s Sets list is about 2.2 MB, so a longer value goes in pieces: at most 3 bytes of
 * UTF-8 per UTF-16 unit keeps a piece well under the cap.
 */
export const ROLLUP_CHUNK_CHARS = 500_000

/** The value stored under the key itself when the JSON is in pieces under `${key}#0000`… */
interface ChunkMarker {
  $rollupChunks: number
}

const isMarker = (v: unknown): v is ChunkMarker =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as ChunkMarker).$rollupChunks === 'number'

const chunkKey = (key: string, i: number): string => `${key}#${String(i).padStart(4, '0')}`

/** The pieces of `key` sort between these ('#' is 0x23, '$' 0x24). */
const chunkRange = (key: string): [string, string] => [`${key}#`, `${key}$`]

/** `text` cut into pieces of at most `size` units, never between the halves of a surrogate pair. */
export function splitJson(text: string, size = ROLLUP_CHUNK_CHARS): string[] {
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    let end = Math.min(at + size, text.length)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--
    out.push(text.slice(at, end))
    at = end
  }
  return out
}

/** The stored rollup under `key`, or undefined when there is none (or it can't be read). */
export function readRollup<T>(db: SqlDb, key: string): T | undefined {
  try {
    const row = db.prepare('SELECT value FROM catalog_rollups WHERE key = ?').get(key) as
      { value: string } | undefined
    if (!row) return undefined
    const value: unknown = JSON.parse(row.value)
    if (!isMarker(value)) return value as T
    const pieces = db
      .prepare('SELECT value FROM catalog_rollups WHERE key > ? AND key < ? ORDER BY key')
      .all(...chunkRange(key)) as { value: string }[]
    if (pieces.length !== value.$rollupChunks) return undefined
    return JSON.parse(pieces.map((p) => p.value).join('')) as T
  } catch {
    return undefined
  }
}

/** Stores `value` under `key`; a failure leaves it unstored (the next read computes again). */
export function storeRollup(db: SqlDb, key: string, game: string, value: unknown): void {
  try {
    const text = JSON.stringify(value)
    const pieces = text.length > ROLLUP_CHUNK_CHARS ? splitJson(text) : null
    const put = db.prepare(
      'INSERT OR REPLACE INTO catalog_rollups (key, value, game) VALUES (?, ?, ?)'
    )
    db.transaction(() => {
      db.prepare('DELETE FROM catalog_rollups WHERE key > ? AND key < ?').run(...chunkRange(key))
      if (!pieces) {
        put.run(key, text, game)
        return
      }
      pieces.forEach((p, i) => put.run(chunkKey(key, i), p, game))
      put.run(key, JSON.stringify({ $rollupChunks: pieces.length } satisfies ChunkMarker), game)
    })()
  } catch {
    /* not stored: the next read computes again */
  }
}
