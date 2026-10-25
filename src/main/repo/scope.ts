import type { SqlDb } from '../db/sql'

export interface EntryInsert {
  printingId: number
  imageId: number
  quantity: number
  notes: string
  ts: string
}

/**
 * Which owner's collection a repo call reads and writes. The desktop has one collection (LOCAL);
 * the server serves one user's live rows per request (userScope).
 */
export interface Scope {
  /** SQL predicate limiting `alias` (a collection_entries alias) to this owner's live rows. */
  where(alias: string): string
  /** Inserts a new entry for this owner and returns its id. */
  insertEntry(db: SqlDb, row: EntryInsert): number
  /** Removes an entry (hard delete locally, tombstone on the server). */
  deleteEntry(db: SqlDb, id: number, ts: string): void
  /**
   * value_snapshots scoping. `insertCols`/`insertVals` are comma-terminated fragments placed before
   * `date` / `?` in an INSERT (and `insertCols + 'date'` is the upsert conflict target).
   */
  snapshotTable: { insertCols: string; insertVals: string }
}

/** SQL for the owner the desktop is showing: the `cloud_active_owner` meta value, or 0 (local). */
export const ACTIVE_OWNER =
  "(SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'cloud_active_owner'), 0))"

export const LOCAL: Scope = {
  where: (alias) => `${alias}.owner_id = ${ACTIVE_OWNER}`,
  insertEntry(db, row) {
    const info = db
      .prepare(
        `INSERT INTO collection_entries (uid, owner_id, printing_id, image_id, quantity, notes, created_at, updated_at)
         VALUES (?, ${ACTIVE_OWNER}, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), row.printingId, row.imageId, row.quantity, row.notes, row.ts, row.ts)
    return Number(info.lastInsertRowid)
  },
  deleteEntry(db, id) {
    db.prepare('DELETE FROM collection_entries WHERE id = ?').run(id)
  },
  snapshotTable: { insertCols: 'owner_id, ', insertVals: `${ACTIVE_OWNER}, ` }
}
