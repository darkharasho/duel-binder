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
  snapshotTable: { where: string; insertCols: string; insertVals: string }
}

export const LOCAL: Scope = {
  where: () => '1',
  insertEntry(db, row) {
    const info = db
      .prepare(
        'INSERT INTO collection_entries (printing_id, image_id, quantity, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(row.printingId, row.imageId, row.quantity, row.notes, row.ts, row.ts)
    return Number(info.lastInsertRowid)
  },
  deleteEntry(db, id) {
    db.prepare('DELETE FROM collection_entries WHERE id = ?').run(id)
  },
  snapshotTable: { where: '1', insertCols: '', insertVals: '' }
}
