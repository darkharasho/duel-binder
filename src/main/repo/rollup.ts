import type { SqlDb } from '../db/sql'

/**
 * `compute()`'s result, stored under `key` until the catalog changes (the triggers of SCHEMA_V24
 * drop every rollup). Only for results that the catalog alone decides: anything about the
 * collection must be read live. The store is a cache, so a failed read or write just computes.
 */
export function catalogRollup<T>(db: SqlDb, key: string, compute: () => T): T {
  try {
    const row = db.prepare('SELECT value FROM catalog_rollups WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (row) return JSON.parse(row.value) as T
  } catch {
    return compute()
  }
  const value = compute()
  try {
    db.prepare('INSERT OR REPLACE INTO catalog_rollups (key, value) VALUES (?, ?)').run(
      key,
      JSON.stringify(value)
    )
  } catch {
    /* not stored: the next read computes again */
  }
  return value
}
