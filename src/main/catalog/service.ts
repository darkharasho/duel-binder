import type Database from 'better-sqlite3'
import type { SqlDb } from '../db/sql'
import { deleteMeta, getMeta, setMeta } from '../db/meta'
import { CloudAuthError, CloudOfflineError, type CloudClient } from '../cloud/client'
import { syncedGames } from '../cloud/engine'
import type { SyncStatus } from '../../shared/types'
import { isGameId, type GameId } from '../../shared/games'
import { inProcessApplier, type CatalogApplier } from '../catalogApplier'
import { catalogCursorKey, catalogStagingKey } from './apply'
import { backfillArtTwins } from './artTwinBackfill'
import { backfillSetSeries } from './seriesBackfill'
import { runSwitch, stageChanges, type SwitchFailure } from './switch'
import { noteUnannounced, unannounced } from './unannounced'

export interface CatalogUpdate {
  changed: boolean
  imagesChanged: boolean
}

export interface CatalogService {
  status(): SyncStatus
  update(client: CloudClient, opts?: { force?: boolean }): Promise<CatalogUpdate>
}

export interface CatalogServiceDeps {
  db: Database.Database
  /** Where the one-time switch backs the database up. */
  backupPath: (now: Date) => string
  emit: (s: SyncStatus) => void
  now?: () => Date
  /** When this app launched: a switch failure that waits for the next launch counts from here. */
  launchedAt: Date
  /** Applies pulled changes; by default on `db` itself (the app passes a worker's). */
  applier?: CatalogApplier
}

/** An unforced update within this long of the last one does nothing. */
const FRESH_MS = 60 * 60 * 1000
const UNCHANGED: CatalogUpdate = { changed: false, imagesChanged: false }

/**
 * The account's games whose catalogs this device keeps: Yu-Gi-Oh!, the game shown, and any game
 * pulled here before. A game the account has but this device has never shown stays unpulled until
 * it is shown: a first Magic pull is about two million rows, too much to put on every device
 * because the account may use the game. A pull staged but never applied doesn't count as pulled.
 */
export function catalogGames(db: SqlDb, account: readonly GameId[]): GameId[] {
  const shown = getMeta(db, 'active_game')
  return account.filter(
    (g) =>
      g === 'ygo' || (isGameId(shown) && g === shown) || getMeta(db, catalogCursorKey(g)) !== null
  )
}

/**
 * The card catalog, kept in step with the server's: the one-time switch to the server's catalog
 * until it's done, then each of the account's games' change feeds from its own cursor
 * (`catalog_cursor` for Yu-Gi-Oh!, `catalog_cursor:pkm` for Pokémon), staged page by page and
 * applied whole.
 */
export function createCatalogService(deps: CatalogServiceDeps): CatalogService {
  const db: SqlDb = deps.db
  const now = deps.now ?? (() => new Date())
  const applier = deps.applier ?? inProcessApplier(deps.db)
  let state: SyncStatus['state'] = 'idle'
  let error: string | null = null
  let inFlight: Promise<CatalogUpdate> | null = null
  let queued: Promise<CatalogUpdate> | null = null

  const switched = (): boolean => getMeta(db, 'catalog_switched_at') !== null

  const switchFailure = (): SwitchFailure | null => {
    const raw = getMeta(db, 'catalog_switch_failed')
    if (raw === null) return null
    try {
      return JSON.parse(raw) as SwitchFailure
    } catch {
      return null
    }
  }

  function status(): SyncStatus {
    const { n } = db.prepare('SELECT count(*) AS n FROM cards').get() as { n: number }
    const failure = switched() ? null : switchFailure()
    return {
      state,
      lastSyncAt: getMeta(db, 'last_sync_at'),
      dbVersion: getMeta(db, 'db_version'),
      cardCount: n,
      error,
      blocked: failure?.reason ?? null,
      blockedRetry: failure?.retry ?? null
    }
  }

  function set(next: SyncStatus['state'], nextError: string | null = null): void {
    state = next
    error = nextError
    deps.emit(status())
  }

  const fresh = (): boolean => {
    const last = Date.parse(getMeta(db, 'last_sync_at') ?? '')
    return !Number.isNaN(last) && now().getTime() - last < FRESH_MS
  }

  /** A failure that waits for the next launch, recorded during this one. */
  const waitingForNextLaunch = (): boolean => {
    const f = switchFailure()
    return f !== null && f.retry === 'next-launch' && Date.parse(f.at) >= deps.launchedAt.getTime()
  }

  /** Reports and clears the unannounced work. */
  const announce = (): CatalogUpdate => {
    const u = unannounced(db)
    if (u === null) return UNCHANGED
    deleteMeta(db, 'catalog_unannounced')
    return { changed: true, imagesChanged: u.imagesChanged }
  }

  /**
   * Downloads `game`'s change feed from its cursor (or, resuming, from its staging cursor) into
   * `catalog_staging`, each page committing with its staging cursor; then, once the feed has no
   * more, has the applier apply everything staged for the game in seq order (on a worker, in short
   * transactions) and advance its cursor. Nothing is applied before the feed is done, so a stopped
   * pull leaves the catalog as it was. A game never pulled before starts from 0.
   */
  async function pullDeltas(client: CloudClient, game: GameId): Promise<void> {
    const cursorKey = catalogCursorKey(game)
    const stagingKey = catalogStagingKey(game)
    let cursor = Number(getMeta(db, stagingKey) ?? getMeta(db, cursorKey) ?? 0)
    for (;;) {
      set('downloading')
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
      set('saving')
      await applier.run({ kind: 'apply', game, cursor: page.cursor, dbVersion: page.dbVersion })
      break
    }
  }

  /** Runs the search index rebuild committed work still waits for. */
  const finishPending = async (): Promise<void> => {
    if (unannounced(db)?.needsFinish) await applier.run({ kind: 'finish' })
  }

  async function doUpdate(client: CloudClient, force: boolean): Promise<CatalogUpdate> {
    await finishPending()
    if (!force && fresh()) return announce()
    set('checking')
    try {
      if (!switched()) {
        if (waitingForNextLaunch()) {
          set('idle')
          return UNCHANGED
        }
        const outcome = await runSwitch(deps.db, {
          client,
          backupPath: deps.backupPath(now()),
          now,
          onProgress: (phase) => set(phase)
        })
        if (outcome.state === 'pending') {
          set('idle')
          return UNCHANGED
        }
        noteUnannounced(db, { cardsChanged: true, imagesChanged: true, needsFinish: true })
      }
      try {
        // Yu-Gi-Oh! first, which every account has; then the account's other games this device uses.
        await pullDeltas(client, 'ygo')
        for (const game of catalogGames(db, await syncedGames(client))) {
          if (game === 'pkm') {
            await backfillArtTwins(db, (since) =>
              client.catalogChanges(since, undefined, ['pokemon_cards'], game)
            )
            await backfillSetSeries(db, (since) =>
              client.catalogChanges(since, undefined, ['sets'], game)
            )
          }
          if (game !== 'ygo') await pullDeltas(client, game)
        }
        setMeta(db, 'last_sync_at', now().toISOString())
      } finally {
        await finishPending()
      }
      const result = announce()
      set('idle')
      return result
    } catch (e) {
      if (e instanceof CloudAuthError || e instanceof CloudOfflineError) {
        set('idle')
        throw e
      }
      console.warn('Catalog update failed', e)
      set('error', (e instanceof Error && e.message) || 'Card data update failed')
      return UNCHANGED
    }
  }

  const start = (client: CloudClient, force: boolean): Promise<CatalogUpdate> => {
    const run = doUpdate(client, force).finally(() => {
      if (inFlight === run) inFlight = null
    })
    inFlight = run
    return run
  }

  return {
    status,
    update(client, opts = {}) {
      const force = opts.force ?? false
      if (inFlight === null) return start(client, force)
      if (!force) return inFlight
      // Forced during another update (a game just shown, say): that one may have picked its games
      // already, so one more runs after it. Later forced asks share that one.
      queued ??= inFlight
        .catch(() => UNCHANGED)
        .then(() => {
          queued = null
          return start(client, true)
        })
      return queued
    }
  }
}
