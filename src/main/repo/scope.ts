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
  /**
   * SQL expression for the game being shown ('ygo' or 'pkm'). Every catalog query filters
   * `<table>.game = <game>`, so a call only ever sees one game.
   */
  game: string
  /** SQL predicate limiting `alias` (a collection_entries alias) to this owner's live rows of the game. */
  where(alias: string): string
  /** Inserts a new entry for this owner and returns its id. */
  insertEntry(db: SqlDb, row: EntryInsert): number
  /**
   * Removes an entry by tombstoning it (and marking the change, as `touch` does). The desktop's never-signed-in
   * owner 0 deletes the row outright instead.
   */
  deleteEntry(db: SqlDb, id: number, ts: string): void
  /**
   * SQL assignment every `UPDATE collection_entries SET …` appends, recording the change for sync:
   * dirty locally, a new server_seq on the server.
   */
  touch: string
  /**
   * value_snapshots scoping. `insertCols`/`insertVals` are comma-terminated fragments placed before
   * `date` / `?` in an INSERT (and `insertCols + 'date'` is the upsert conflict target); `where` limits a read
   * to this owner's rows of the game.
   */
  snapshotTable: { insertCols: string; insertVals: string; where: string }
}

/** SQL for the owner the desktop is showing: the `cloud_active_owner` meta value, or 0 (local). */
export const ACTIVE_OWNER =
  "(SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'cloud_active_owner'), 0))"

/** SQL for the game the desktop or phone is showing: the `active_game` meta value, or 'ygo'. */
export const ACTIVE_GAME =
  "(SELECT COALESCE((SELECT value FROM meta WHERE key = 'active_game'), 'ygo'))"

/**
 * The active owner's collection of one game on this device. `game` is trusted SQL: ACTIVE_GAME or a
 * quoted game id literal.
 */
export function localScope(game: string): Scope {
  return {
    game,
    where: (alias) =>
      `${alias}.owner_id = ${ACTIVE_OWNER} AND ${alias}.game = ${game} AND ${alias}.deleted_at IS NULL`,
    insertEntry(db, row) {
      const info = db
        .prepare(
          `INSERT INTO collection_entries (uid, owner_id, game, printing_id, image_id, quantity, notes, created_at, updated_at)
           VALUES (?, ${ACTIVE_OWNER}, ${game}, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          row.printingId,
          row.imageId,
          row.quantity,
          row.notes,
          row.ts,
          row.ts
        )
      return Number(info.lastInsertRowid)
    },
    deleteEntry(db, id, ts) {
      // Owner 0 (never signed in) rows were never on the server: no one needs a tombstone, so drop the row.
      db.prepare(
        `DELETE FROM collection_entries WHERE id = ? AND deleted_at IS NULL AND owner_id = 0 AND owner_id = ${ACTIVE_OWNER}
         AND game = ${game}`
      ).run(id)
      db.prepare(
        `UPDATE collection_entries SET deleted_at = ?, updated_at = ?, dirty = 1
         WHERE id = ? AND deleted_at IS NULL AND owner_id = ${ACTIVE_OWNER} AND game = ${game}`
      ).run(ts, ts, id)
    },
    touch: 'dirty = 1',
    snapshotTable: {
      insertCols: 'owner_id, game, ',
      insertVals: `${ACTIVE_OWNER}, ${game}, `,
      where: `owner_id = ${ACTIVE_OWNER} AND game = ${game}`
    }
  }
}

/** The active owner's collection of the active game: what the desktop and phone show. */
export const LOCAL: Scope = localScope(ACTIVE_GAME)
