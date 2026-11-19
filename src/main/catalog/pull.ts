import { existsSync, rmSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { catalogShape, SNAPSHOT_GAMES } from '../../shared/catalogSnapshot'
import type { GameId } from '../../shared/games'
import type { SyncStatus } from '../../shared/types'
import { CatalogApplierStopped, type CatalogApplier } from '../catalogApplier'
import type { CloudClient } from '../cloud/client'
import { deleteMeta, getMeta, setMeta } from '../db/meta'
import { catalogCursorKey, catalogStagingKey } from './apply'
import { snapshotKey, snapshotProgress } from './snapshot'
import { downloadSnapshot } from './snapshotDownload'
import { stageChanges } from './switch'

export interface PullGameDeps {
  db: Database.Database
  client: CloudClient
  game: GameId
  applier: CatalogApplier
  set: (state: SyncStatus['state']) => void
  /** Where snapshots download to; without one, a first pull reads the whole feed. */
  snapshotDir?: string
  /** The pause before a snapshot download's second try (doubled before its third). */
  snapshotRetryDelayMs?: number
}

/** A game never pulled here, with nothing staged and no cards: a snapshot may fill it. */
export function firstPull(db: Database.Database, game: GameId): boolean {
  return (
    getMeta(db, catalogCursorKey(game)) === null &&
    getMeta(db, catalogStagingKey(game)) === null &&
    db.prepare('SELECT 1 FROM cards WHERE game = ? LIMIT 1').get(game) === undefined
  )
}

/**
 * Fills a first pull of `game` from its snapshot, or carries on an import a quit stopped. Any
 * failure is logged and forgotten, and the feed takes over (from 0 when nothing landed; rows
 * an import left are upserted again by the feed). A quit (the applier stopped) keeps
 * `catalog_snapshot:<game>` and the file, and the next pull resumes the import.
 */
async function fromSnapshot(deps: PullGameDeps): Promise<void> {
  const { db, game, client } = deps
  let file: string | null = null
  try {
    const saved = snapshotProgress(db, game)
    if (saved && !existsSync(saved.file)) deleteMeta(db, snapshotKey(game))
    if (saved && existsSync(saved.file)) {
      file = saved.file
      deps.set('saving')
      await deps.applier.run({ kind: 'snapshot', game, ...saved })
      return
    }
    if (
      !deps.snapshotDir ||
      !SNAPSHOT_GAMES.includes(game) ||
      !client.catalogSnapshot ||
      !client.download ||
      !firstPull(db, game)
    )
      return
    deps.set('downloading')
    const offer = await client.catalogSnapshot(game, catalogShape())
    if (!offer) return
    file = await downloadSnapshot(client, offer, deps.snapshotDir, {
      retryDelayMs: deps.snapshotRetryDelayMs
    })
    // Another update may have pulled the game while this one downloaded.
    if (!firstPull(db, game)) return
    deps.set('saving')
    await deps.applier.run({
      kind: 'snapshot',
      game,
      file,
      cursor: offer.cursor,
      dbVersion: offer.dbVersion
    })
  } catch (e) {
    // The app is quitting: the import's progress and file stay for the next launch.
    if (e instanceof CatalogApplierStopped) {
      file = null
      throw e
    }
    console.warn(`Catalog ${game}: snapshot skipped`, e)
    deleteMeta(db, snapshotKey(game))
  } finally {
    // Kept only for an import still under way.
    if (file !== null && snapshotProgress(db, game) === null) rmSync(file, { force: true })
  }
}

/**
 * Downloads `game`'s change feed from its cursor (or, resuming, from its staging cursor) into
 * `catalog_staging`, each page committing with its staging cursor; then, once the feed has no
 * more, has the applier apply everything staged for the game in seq order (on a worker, in short
 * transactions) and advance its cursor. Nothing is applied before the feed is done, so a stopped
 * pull leaves the catalog as it was. A game never pulled before starts from its snapshot when
 * there is one (see fromSnapshot), else from 0.
 */
export async function pullGame(deps: PullGameDeps): Promise<void> {
  const { db, client, game } = deps
  await fromSnapshot(deps)
  const cursorKey = catalogCursorKey(game)
  const stagingKey = catalogStagingKey(game)
  let cursor = Number(getMeta(db, stagingKey) ?? getMeta(db, cursorKey) ?? 0)
  for (;;) {
    deps.set('downloading')
    const page = await client.catalogChanges(cursor, undefined, undefined, game)
    if (page.more && page.cursor <= cursor) throw new Error('The catalog feed stopped advancing')
    if (page.more) {
      db.transaction(() => {
        stageChanges(db, page.changes, game)
        setMeta(db, stagingKey, String(page.cursor))
      })()
      cursor = page.cursor
      continue
    }
    const anyStaged = getMeta(db, stagingKey) !== null
    if (page.changes.length === 0 && !anyStaged) {
      db.transaction(() => {
        setMeta(db, cursorKey, String(page.cursor))
        if (page.dbVersion !== null) setMeta(db, 'db_version', page.dbVersion)
      })()
      break
    }
    db.transaction(() => {
      stageChanges(db, page.changes, game)
      setMeta(db, stagingKey, String(page.cursor))
    })()
    deps.set('saving')
    await deps.applier.run({ kind: 'apply', game, cursor: page.cursor, dbVersion: page.dbVersion })
    break
  }
}
