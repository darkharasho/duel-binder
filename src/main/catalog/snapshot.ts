import { rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { CATALOG_TABLES, type CatalogTable } from '../../shared/catalogTables'
import { catalogShape } from '../../shared/catalogSnapshot'
import type { GameId } from '../../shared/games'
import { deleteMeta, getMeta, setMeta, type MetaKey } from '../db/meta'
import { catalogCursorKey, catalogStagingKey } from './apply'
import { noteUnannounced } from './unannounced'

/** Snapshot rows copied per transaction. */
export const SNAPSHOT_CHUNK = 5000

/** Where an import of `game`'s snapshot has got to (JSON `SnapshotProgress`). */
export const snapshotKey = (game: GameId): MetaKey => `catalog_snapshot:${game}` as MetaKey

export interface SnapshotProgress {
  cursor: number
  file: string
  dbVersion: string | null
  /** The table being copied, and the last snapshot rowid of it copied. */
  table: string
  after: number
}

export function snapshotProgress(db: Database.Database, game: GameId): SnapshotProgress | null {
  const raw = getMeta(db, snapshotKey(game))
  if (raw === null) return null
  try {
    return JSON.parse(raw) as SnapshotProgress
  } catch {
    return null
  }
}

/**
 * The catalog tables with rows of `game`, parents first. CATALOG_TABLES is in upload order,
 * which already puts `cards` before the tables pointing at it and `card_images` before the
 * game's image table.
 */
export const snapshotTables = (game: GameId): CatalogTable[] =>
  CATALOG_TABLES.filter((t) => t.games.includes(game))

/** A table's writable columns in `schema` (generated columns left out). */
function writableColumns(db: Database.Database, schema: string, table: string): string[] {
  return (
    db.prepare('SELECT name, hidden FROM pragma_table_xinfo(?, ?)').all(table, schema) as {
      name: string
      hidden: number
    }[]
  )
    .filter((c) => c.hidden === 0)
    .map((c) => c.name)
}

const quoted = (cols: string[]): string => cols.map((c) => `"${c}"`).join(', ')

/**
 * Writes `game`'s catalog rows to a new SQLite file at `file`: each of its tables with the
 * desktop's writable columns (`card_printings` without its local `id`), rows of other games left
 * out where a table has a `game` column, plus a one-row `snapshot_meta`. No search index: the
 * importing app rebuilds its own. Returns the row count per table.
 */
export function exportSnapshot(
  db: Database.Database,
  game: GameId,
  file: string,
  info: { cursor: number; dbVersion: string | null }
): Record<string, number> {
  rmSync(file, { force: true })
  const counts: Record<string, number> = {}
  db.prepare('ATTACH DATABASE ? AS snap').run(file)
  try {
    db.transaction(() => {
      for (const t of snapshotTables(game)) {
        const all = writableColumns(db, 'main', t.name)
        const cols = t.name === 'card_printings' ? all.filter((c) => c !== 'id') : all
        const where = all.includes('game') ? 'WHERE game = ?' : ''
        db.prepare(
          `CREATE TABLE snap."${t.name}" AS SELECT ${quoted(cols)} FROM main."${t.name}" ${where} ORDER BY rowid`
        ).run(...(where ? [game] : []))
        counts[t.name] = (
          db.prepare(`SELECT count(*) AS n FROM snap."${t.name}"`).get() as { n: number }
        ).n
      }
      db.exec(
        `CREATE TABLE snap.snapshot_meta (game TEXT NOT NULL, cursor INTEGER NOT NULL,
           db_version TEXT, shape TEXT NOT NULL, built_at TEXT NOT NULL, counts TEXT NOT NULL)`
      )
      db.prepare('INSERT INTO snap.snapshot_meta VALUES (?, ?, ?, ?, ?, ?)').run(
        game,
        info.cursor,
        info.dbVersion,
        catalogShape(),
        new Date().toISOString(),
        JSON.stringify(counts)
      )
    })()
  } finally {
    db.exec('DETACH DATABASE snap')
  }
  const out = new Database(file)
  try {
    out.exec('VACUUM')
  } finally {
    out.close()
  }
  return counts
}

/**
 * Copies a snapshot file's rows into `db` (which must have foreign keys off: tables are copied
 * one after another, in chunks), recording progress in `catalog_snapshot:<game>` so a stopped
 * import carries on; then, in one last transaction, sets the game's cursor and `db_version`.
 * `INSERT OR IGNORE` makes a resumed chunk harmless. `tx` runs one transaction; `pause` is
 * called between them with how long the last held the write lock.
 */
export function importSnapshot(
  db: Database.Database,
  job: { game: GameId; file: string; cursor: number; dbVersion: string | null },
  tx: (fn: () => void) => void,
  chunk: number,
  pause?: (heldMs: number) => void
): void {
  db.prepare('ATTACH DATABASE ? AS snap').run(job.file)
  try {
    const meta = db.prepare('SELECT game, shape FROM snap.snapshot_meta').get() as
      | { game: string; shape: string }
      | undefined
    if (meta?.game !== job.game || meta.shape !== catalogShape())
      throw new Error('Snapshot is for another game or catalog shape')
    const tables = snapshotTables(job.game).map((t) => t.name)
    const saved = snapshotProgress(db, job.game)
    const resume =
      saved && saved.file === job.file && saved.cursor === job.cursor ? saved : null
    let at = resume ? Math.max(tables.indexOf(resume.table), 0) : 0
    let after = resume && tables[at] === resume.table ? resume.after : -1
    const progress = (table: string, last: number): void =>
      setMeta(
        db,
        snapshotKey(job.game),
        JSON.stringify({
          cursor: job.cursor,
          file: job.file,
          dbVersion: job.dbVersion,
          table,
          after: last
        } satisfies SnapshotProgress)
      )
    if (!resume) tx(() => progress(tables[0], -1))

    for (; at < tables.length; at++, after = -1) {
      const table = tables[at]
      const main = new Set(writableColumns(db, 'main', table))
      const cols = writableColumns(db, 'snap', table).filter((c) => main.has(c))
      const lastOf = db.prepare(
        `SELECT max(rowid) AS last FROM (SELECT rowid FROM snap."${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?)`
      )
      const copy = db.prepare(
        `INSERT OR IGNORE INTO main."${table}" (${quoted(cols)})
         SELECT ${quoted(cols)} FROM snap."${table}" WHERE rowid > ? AND rowid <= ? ORDER BY rowid`
      )
      for (;;) {
        const started = performance.now()
        let done = false
        tx(() => {
          const last = (lastOf.get(after, chunk) as { last: number | null }).last
          if (last === null) {
            done = true
            return
          }
          copy.run(after, last)
          progress(table, last)
          after = last
        })
        if (done) break
        pause?.(performance.now() - started)
      }
    }

    tx(() => {
      setMeta(db, catalogCursorKey(job.game), String(job.cursor))
      if (job.dbVersion !== null) setMeta(db, 'db_version', job.dbVersion)
      deleteMeta(db, snapshotKey(job.game))
      deleteMeta(db, catalogStagingKey(job.game))
      noteUnannounced(db, { cardsChanged: true, imagesChanged: true, needsFinish: true })
    })
  } finally {
    db.exec('DETACH DATABASE snap')
  }
}
