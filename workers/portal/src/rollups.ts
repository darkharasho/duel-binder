import type { SqlDb } from '../../../src/main/db/sql'

/**
 * How long a game's catalog must be quiet before its rollups are dropped on a read. A catalog
 * upload (1 to 1.5 hours of small batches, table by table, so one game can be quiet for a while
 * mid-upload) ends with /admin/catalog/finish, which drops them at once; this only covers a change
 * outside an upload, or an upload that died before finishing. Longer than an upload, so a game's
 * rollups are never rebuilt partway through one.
 */
export const ROLLUP_QUIET_MS = 2 * 60 * 60_000

/**
 * Drops `game`'s stored rollups when its catalog changed (server-44's triggers note each change in
 * catalog_rollup_changes) and has since been quiet for ROLLUP_QUIET_MS, or at once with `force`.
 * Until then the old rollups keep being served, so a read between an upload's batches never pays
 * for a rebuild the next batch would undo. The next read builds a dropped rollup again.
 */
export function settleRollups(db: SqlDb, game: string, now: Date, force = false): void {
  const row = db
    .prepare('SELECT changed_at FROM catalog_rollup_changes WHERE game = ?')
    .get(game) as { changed_at: string } | undefined
  if (!row) return
  if (!force && row.changed_at > new Date(now.getTime() - ROLLUP_QUIET_MS).toISOString()) return
  db.transaction(() => {
    db.prepare('DELETE FROM catalog_rollups WHERE game = ? OR game IS NULL').run(game)
    // Only the change it settled: one noted meanwhile (none can be, in one synchronous call) stays.
    db.prepare('DELETE FROM catalog_rollup_changes WHERE game = ? AND changed_at = ?').run(
      game,
      row.changed_at
    )
  })()
}

/** settleRollups, at once, for every game whose catalog changed: a catalog upload has finished. */
export function settleAllRollups(db: SqlDb, now: Date): void {
  const games = db.prepare('SELECT game FROM catalog_rollup_changes').all() as { game: string }[]
  for (const { game } of games) settleRollups(db, game, now, true)
}
