import type Database from 'better-sqlite3'
import type { SqlDb } from '../db/sql'
import { deleteMeta, getMeta, setMeta } from '../db/meta'
import { CloudAuthError, CloudOfflineError, type CloudClient } from '../cloud/client'
import { syncedGames } from '../cloud/engine'
import type { SyncStatus } from '../../shared/types'
import { isGameId, type GameId } from '../../shared/games'
import { inProcessApplier, type CatalogApplier } from '../catalogApplier'
import { catalogCursorKey } from './apply'
import { firstPull, pullGame } from './pull'
import { snapshotKey } from './snapshot'
import { backfillArtTwins } from './artTwinBackfill'
import { backfillSetSeries } from './seriesBackfill'
import { runSwitch, type SwitchFailure } from './switch'
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
  /** Where catalog snapshots download to; without one, a game's first pull reads the whole feed. */
  snapshotDir?: string
}

/** An unforced update within this long of the last one does nothing. */
const FRESH_MS = 60 * 60 * 1000
const UNCHANGED: CatalogUpdate = { changed: false, imagesChanged: false }

/**
 * The account's games whose catalogs this device keeps: Yu-Gi-Oh!, the game shown, and any game
 * pulled here before (or started importing a snapshot of). A game the account has but this device has never shown stays unpulled until
 * it is shown: a first Magic pull is about two million rows, too much to put on every device
 * because the account may use the game. A pull staged but never applied doesn't count as pulled.
 */
export function catalogGames(db: SqlDb, account: readonly GameId[]): GameId[] {
  const shown = getMeta(db, 'active_game')
  return account.filter(
    (g) =>
      g === 'ygo' ||
      (isGameId(shown) && g === shown) ||
      getMeta(db, catalogCursorKey(g)) !== null ||
      getMeta(db, snapshotKey(g)) !== null
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

  const pullDeltas = (client: CloudClient, game: GameId): Promise<void> =>
    pullGame({ db: deps.db, client, game, applier, set, snapshotDir: deps.snapshotDir })

  /** Runs the search index rebuild committed work still waits for. */
  const finishPending = async (): Promise<void> => {
    if (unannounced(db)?.needsFinish) await applier.run({ kind: 'finish' })
  }

  async function doUpdate(client: CloudClient, force: boolean): Promise<CatalogUpdate> {
    await finishPending()
    if (!force && fresh()) return announce()
    set('checking')
    try {
      // A fresh install has no catalog of its own to move over: it skips the switch, and its
      // Yu-Gi-Oh! pull below starts from the snapshot like any other game's first pull.
      if (!switched() && firstPull(deps.db, 'ygo')) {
        const at = now().toISOString()
        db.transaction(() => {
          setMeta(db, 'catalog_switched_at', at)
          deleteMeta(db, 'catalog_switch_failed')
        })()
      }
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
