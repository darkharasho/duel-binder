import type { SqlDb } from '../db/sql'
import { isGameId, type GameId } from '../../shared/games'

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
   * `+<table>.game = <game>`, so a call only ever sees one game. The unary `+` on `cards`,
   * `card_printings` and `card_images` keeps the server's `ix_*_game_seq` indexes (meant only for
   * the per-game catalog feed) out of these plans: without ANALYZE stats the planner would walk
   * every row of the game through them instead of using the query's real index.
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
   * wishlist_entries scoping: the owner column and its value, the row's change-marker column and
   * value for an insert, and the SQL assignment recording a change (dirty, or a new seq).
   */
  wishlist: {
    ownerCol: string
    owner: string
    markerCol: string
    marker: string
    touch: string
  }
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

/** The game a scope shows, resolved to 'ygo' or 'pkm' for code that picks game-specific filters. */
export function scopeGame(db: SqlDb, scope: Scope): GameId {
  const { game } = db.prepare(`SELECT ${scope.game} AS game`).get() as { game: string }
  return isGameId(game) ? game : 'ygo'
}

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
    wishlist: {
      ownerCol: 'owner_id',
      owner: ACTIVE_OWNER,
      markerCol: 'dirty',
      marker: '1',
      touch: 'dirty = 1'
    },
    snapshotTable: {
      insertCols: 'owner_id, game, ',
      insertVals: `${ACTIVE_OWNER}, ${game}, `,
      where: `owner_id = ${ACTIVE_OWNER} AND game = ${game}`
    }
  }
}

/** The active owner's collection of the active game: what the desktop and phone show. */
export const LOCAL: Scope = localScope(ACTIVE_GAME)
