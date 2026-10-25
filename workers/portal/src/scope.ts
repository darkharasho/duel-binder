import type { Scope } from '../../../src/main/repo/scope'

/** SQL for the next server_seq: one past the highest in use (the column is unique). */
export const NEXT_SEQ = '(SELECT COALESCE(MAX(server_seq), 0) + 1 FROM collection_entries)'

/** One user's live (non-deleted) rows on the server. */
export function userScope(userId: number): Scope {
  if (!Number.isSafeInteger(userId)) throw new Error(`Invalid user id: ${userId}`)
  return {
    where: (alias) => `${alias}.user_id = ${userId} AND ${alias}.deleted_at IS NULL`,
    insertEntry(db, row) {
      const info = db
        .prepare(
          `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, notes, created_at, updated_at, server_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_SEQ})`
        )
        .run(userId, crypto.randomUUID(), row.printingId, row.imageId, row.quantity, row.notes, row.ts, row.ts)
      return Number(info.lastInsertRowid)
    },
    deleteEntry(db, id, ts) {
      db.prepare(
        `UPDATE collection_entries SET deleted_at = ?, updated_at = ?, server_seq = ${NEXT_SEQ}
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
      ).run(ts, ts, id, userId)
    },
    touch: `server_seq = ${NEXT_SEQ}`,
    snapshotTable: { insertCols: 'user_id, ', insertVals: `${userId}, ` }
  }
}
