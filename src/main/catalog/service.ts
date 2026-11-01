import type Database from 'better-sqlite3'
import type { SqlDb } from '../db/sql'
import { deleteMeta, getMeta, setMeta } from '../db/meta'
import { CloudAuthError, CloudOfflineError, type CloudClient } from '../cloud/client'
import { syncedGames } from '../cloud/engine'
import type { SyncStatus } from '../../shared/types'
import type { GameId } from '../../shared/games'
import { catalogCursorKey, catalogStagingKey, finishApply } from './apply'
import { backfillArtTwins } from './artTwinBackfill'
import { applyStaged, clearStaged, runSwitch, stageChanges, type SwitchFailure } from './switch'

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
}

/** An unforced update within this long of the last one does nothing. */
const FRESH_MS = 60 * 60 * 1000
const UNCHANGED: CatalogUpdate = { changed: false, imagesChanged: false }

/** Committed catalog work not yet announced; stored as JSON in meta `catalog_unannounced`. */
interface Unannounced {
  cardsChanged: boolean
  imagesChanged: boolean
  /** `finishApply` (the search index rebuild) hasn't run for it yet. */
  needsFinish: boolean
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
  let state: SyncStatus['state'] = 'idle'
  let error: string | null = null
  let inFlight: Promise<CatalogUpdate> | null = null

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

  /**
   * Catalog work already committed but not yet reported by a successful update (and, with
   * `needsFinish`, not yet followed by `finishApply`). Survives a failed update and a restart.
   */
  const unannounced = (): Unannounced | null => {
    const raw = getMeta(db, 'catalog_unannounced')
    if (raw === null) return null
    try {
      return JSON.parse(raw) as Unannounced
    } catch {
      return { cardsChanged: true, imagesChanged: true, needsFinish: true }
    }
  }

  /** ORs `work` into the unannounced record; call it in the transaction that commits the work. */
  const noteUnannounced = (work: Unannounced): void => {
    const u = unannounced()
    const merged: Unannounced = {
      cardsChanged: work.cardsChanged || (u?.cardsChanged ?? false),
      imagesChanged: work.imagesChanged || (u?.imagesChanged ?? false),
      needsFinish: work.needsFinish || (u?.needsFinish ?? false)
    }
    setMeta(db, 'catalog_unannounced', JSON.stringify(merged))
  }

  /** Runs the `finishApply` committed work still waits for. */
  const finishPending = (): void => {
    const u = unannounced()
    if (!u?.needsFinish) return
    db.transaction(() => {
      finishApply(db, { applied: 1, cardsChanged: u.cardsChanged, imagesChanged: u.imagesChanged })
      setMeta(db, 'catalog_unannounced', JSON.stringify({ ...u, needsFinish: false }))
    })()
  }

  /** Reports and clears the unannounced work. */
  const announce = (): CatalogUpdate => {
    const u = unannounced()
    if (u === null) return UNCHANGED
    deleteMeta(db, 'catalog_unannounced')
    return { changed: true, imagesChanged: u.imagesChanged }
  }

  /**
   * Downloads `game`'s change feed from its cursor (or, resuming, from its staging cursor) into
   * `catalog_staging`, each page committing with its staging cursor; then, once the feed has no
   * more, applies everything staged for the game in seq order in one transaction that also advances
   * its cursor and clears its staging. Applying page by page could fail a foreign key forever: a
   * card changed after its new printings is listed at its later seq, on a later page. A game never
   * pulled before starts from 0.
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
      if (page.changes.length > 0 || anyStaged) set('saving')
      db.transaction(() => {
        stageChanges(db, page.changes, game)
        const r = applyStaged(db, game)
        if (r.applied > 0)
          noteUnannounced({
            cardsChanged: r.cardsChanged,
            imagesChanged: r.imagesChanged,
            needsFinish: true
          })
        setMeta(db, cursorKey, String(page.cursor))
        if (page.dbVersion !== null) setMeta(db, 'db_version', page.dbVersion)
        clearStaged(db, game)
        deleteMeta(db, stagingKey)
      })()
      break
    }
  }

  async function doUpdate(client: CloudClient, force: boolean): Promise<CatalogUpdate> {
    finishPending()
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
        noteUnannounced({ cardsChanged: true, imagesChanged: true, needsFinish: true })
      }
      try {
        // Yu-Gi-Oh! first, which every account has; then the account's other games.
        await pullDeltas(client, 'ygo')
        for (const game of await syncedGames(client)) {
          if (game === 'pkm')
            await backfillArtTwins(db, (since) =>
              client.catalogChanges(since, undefined, ['pokemon_cards'], game)
            )
          if (game !== 'ygo') await pullDeltas(client, game)
        }
        setMeta(db, 'last_sync_at', now().toISOString())
      } finally {
        finishPending()
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

  return {
    status,
    update(client, opts = {}) {
      inFlight ??= doUpdate(client, opts.force ?? false).finally(() => {
        inFlight = null
      })
      return inFlight
    }
  }
}
