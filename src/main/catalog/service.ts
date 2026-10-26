import type Database from 'better-sqlite3'
import type { SqlDb } from '../db/sql'
import { deleteMeta, getMeta, setMeta } from '../db/meta'
import { CloudAuthError, CloudOfflineError, type CloudClient } from '../cloud/client'
import type { SyncStatus } from '../../shared/types'
import { applyChanges, finishApply } from './apply'
import { runSwitch, type SwitchFailure } from './switch'

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
 * until it's done, then the change feed from `catalog_cursor`, a page per transaction with its cursor.
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
    return {
      state,
      lastSyncAt: getMeta(db, 'last_sync_at'),
      dbVersion: getMeta(db, 'db_version'),
      cardCount: n,
      error,
      blocked: switched() ? null : (switchFailure()?.reason ?? null)
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

  /** Applies the change feed from `catalog_cursor` to its end, a page per transaction. */
  async function pullDeltas(client: CloudClient): Promise<void> {
    let cursor = Number(getMeta(db, 'catalog_cursor') ?? 0)
    for (;;) {
      set('downloading')
      const page = await client.catalogChanges(cursor)
      if (page.more && page.cursor <= cursor) throw new Error('The catalog feed stopped advancing')
      if (page.changes.length > 0) set('saving')
      db.transaction(() => {
        const r = applyChanges(db, page.changes)
        if (r.applied > 0)
          noteUnannounced({
            cardsChanged: r.cardsChanged,
            imagesChanged: r.imagesChanged,
            needsFinish: true
          })
        setMeta(db, 'catalog_cursor', String(page.cursor))
        if (page.dbVersion !== null) setMeta(db, 'db_version', page.dbVersion)
      })()
      cursor = page.cursor
      if (!page.more) break
    }
    setMeta(db, 'last_sync_at', now().toISOString())
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
        await pullDeltas(client)
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
