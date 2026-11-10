import type { SqlDb } from '../db/sql'

/**
 * `compute()`'s result, stored under `key` until the catalog changes (the triggers of SCHEMA_V47
 * drop a game's rollups when its catalog rows change, and every rollup when a shared table does).
 * `game` is the game the result is about. Only for results that the catalog alone decides: anything
 * about the collection must be read live. The store is a cache, so a failed read or write just computes.
 */
export function catalogRollup<T>(db: SqlDb, key: string, game: string, compute: () => T): T {
  const stored = readRollup<T>(db, key)
  if (stored !== undefined) return stored
  const value = compute()
  storeRollup(db, key, game, value)
  return value
}

/** The stored rollup under `key`, or undefined when there is none (or it can't be read). */
export function readRollup<T>(db: SqlDb, key: string): T | undefined {
  try {
    const row = db.prepare('SELECT value FROM catalog_rollups WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  } catch {
    return undefined
  }
}

/** Stores `value` under `key`; a failure leaves it unstored (the next read computes again). */
export function storeRollup(db: SqlDb, key: string, game: string, value: unknown): void {
  try {
    db.prepare('INSERT OR REPLACE INTO catalog_rollups (key, value, game) VALUES (?, ?, ?)').run(
      key,
      JSON.stringify(value),
      game
    )
  } catch {
    /* not stored: the next read computes again */
  }
}
