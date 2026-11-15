import type Database from 'better-sqlite3'
import type { CatalogChange } from '../../shared/catalogFeed'
import type { GameId } from '../../shared/games'
import { deleteMeta, setMeta } from '../db/meta'
import { applyChanges, catalogCursorKey, catalogStagingKey } from './apply'
import { importSnapshot, SNAPSHOT_CHUNK } from './snapshot'
import { STAGED_GAME } from './switch'
import { finishPending, noteUnannounced } from './unannounced'

/** Staged changes applied per transaction: short enough that the app's own writes barely wait. */
export const APPLY_CHUNK = 500

/** Catalog tables whose rows point at other catalog rows. */
const CHILD_TABLES = [
  'card_printings',
  'card_images',
  'pokemon_cards',
  'onepiece_cards',
  'onepiece_images',
  'mtg_cards',
  'mtg_images'
]

export type CatalogApplyJob =
  | {
      kind: 'apply'
      game: GameId
      /** Where the feed ended: the game's cursor once everything staged is applied. */
      cursor: number
      dbVersion: string | null
    }
  | { kind: 'finish' }
  | {
      kind: 'snapshot'
      game: GameId
      /** A downloaded, unpacked snapshot file (see exportSnapshot). */
      file: string
      cursor: number
      dbVersion: string | null
    }

export interface ApplyJobOptions {
  /** Take the write lock when each transaction starts: another connection may be writing. */
  immediate?: boolean
  chunk?: number
  /**
   * Called between chunks with how long the last one held the write lock. A worker sleeps that
   * long: another connection waiting on the lock polls for it now and then, and would keep
   * missing it if the next chunk took it straight back.
   */
  pause?: (heldMs: number) => void
}

/**
 * Applies everything staged for a game, in seq order, a chunk per transaction that also deletes
 * the chunk from staging; then moves the game's cursor and drops its staging cursor. Stopped
 * partway, the rest is still staged and the next run carries on. Applying chunk by chunk means a
 * printing can land before its card (a snapshot lists each row at its latest seq), so `db` must
 * have foreign keys off; the cascades the catalog relies on are done by hand in `applyChanges`,
 * and what still dangles after a multi-chunk apply is logged.
 *
 * `finish` runs the search index rebuild committed work waits for.
 */
export function runApplyJob(
  db: Database.Database,
  job: CatalogApplyJob,
  opts: ApplyJobOptions = {}
): void {
  const tx = (fn: () => void): void => {
    const t = db.transaction(fn)
    if (opts.immediate) t.immediate()
    else t()
  }
  if (job.kind === 'finish') {
    finishPending(db, tx)
    return
  }
  if (db.pragma('foreign_keys', { simple: true }) !== 0)
    throw new Error('The catalog is applied with foreign keys off')
  if (job.kind === 'snapshot') {
    importSnapshot(db, job, tx, opts.chunk ?? SNAPSHOT_CHUNK, opts.pause)
    checkReferences(db, job.game)
    return
  }
  const chunk = opts.chunk ?? APPLY_CHUNK
  const page = db.prepare(
    `SELECT seq, row FROM catalog_staging WHERE seq > ? AND ${STAGED_GAME} = ? ORDER BY seq LIMIT ?`
  )
  const unstage = db.prepare('DELETE FROM catalog_staging WHERE seq = ?')
  let after = -1
  let chunks = 0
  let more = true
  while (more) {
    const started = performance.now()
    tx(() => {
      const rows = page.all(after, job.game, chunk) as { seq: number; row: string }[]
      more = rows.length > 0
      if (!more) return
      const r = applyChanges(
        db,
        rows.map((x) => JSON.parse(x.row) as CatalogChange)
      )
      for (const x of rows) unstage.run(x.seq)
      if (r.applied > 0)
        noteUnannounced(db, {
          cardsChanged: r.cardsChanged,
          imagesChanged: r.imagesChanged,
          needsFinish: true
        })
      after = rows[rows.length - 1].seq
      chunks++
    })
    if (more) opts.pause?.(performance.now() - started)
  }
  tx(() => {
    setMeta(db, catalogCursorKey(job.game), String(job.cursor))
    if (job.dbVersion !== null) setMeta(db, 'db_version', job.dbVersion)
    deleteMeta(db, catalogStagingKey(job.game))
  })
  // Only a chunk boundary can split a row from the row it points at.
  if (chunks > 1) checkReferences(db, job.game)
}

function checkReferences(db: Database.Database, game: GameId): void {
  for (const table of CHILD_TABLES) {
    const broken = db.prepare(`PRAGMA foreign_key_check(${table})`).all().length
    if (broken > 0) console.warn(`Catalog ${game}: ${broken} ${table} rows point at missing rows`)
  }
}

/** Runs `fn` with `db`'s foreign keys off (not inside a transaction: the pragma is a no-op there). */
export function withoutForeignKeys<T>(db: Database.Database, fn: () => T): T {
  const was = db.pragma('foreign_keys', { simple: true }) !== 0
  db.pragma('foreign_keys = OFF')
  try {
    return fn()
  } finally {
    if (was) db.pragma('foreign_keys = ON')
  }
}
