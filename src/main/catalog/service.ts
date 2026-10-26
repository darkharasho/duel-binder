import type Database from 'better-sqlite3'
import type { SqlDb } from '../db/sql'
import { getMeta, setMeta } from '../db/meta'
import { CloudAuthError, CloudOfflineError, type CloudClient } from '../cloud/client'
import type { SyncStatus } from '../../shared/types'
import { applyChanges, finishApply, type ApplyResult } from './apply'
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

  /** Applies the change feed from `catalog_cursor` to its end. */
  async function pullDeltas(client: CloudClient): Promise<ApplyResult> {
    const total: ApplyResult = { applied: 0, cardsChanged: false, imagesChanged: false }
    let cursor = Number(getMeta(db, 'catalog_cursor') ?? 0)
    for (;;) {
      set('downloading')
      const page = await client.catalogChanges(cursor)
      if (page.more && page.cursor <= cursor) throw new Error('The catalog feed stopped advancing')
      if (page.changes.length > 0) set('saving')
      db.transaction(() => {
        const r = applyChanges(db, page.changes)
        total.applied += r.applied
        total.cardsChanged ||= r.cardsChanged
        total.imagesChanged ||= r.imagesChanged
        setMeta(db, 'catalog_cursor', String(page.cursor))
        if (page.dbVersion !== null) setMeta(db, 'db_version', page.dbVersion)
      })()
      cursor = page.cursor
      if (!page.more) break
    }
    if (total.applied > 0) db.transaction(() => finishApply(db, total))()
    setMeta(db, 'last_sync_at', now().toISOString())
    return total
  }

  async function doUpdate(client: CloudClient, force: boolean): Promise<CatalogUpdate> {
    if (!force && fresh()) return UNCHANGED
    set('checking')
    try {
      let switchedNow = false
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
        switchedNow = true
      }
      const deltas = await pullDeltas(client)
      set('idle')
      return {
        changed: switchedNow || deltas.applied > 0,
        imagesChanged: switchedNow || deltas.imagesChanged
      }
    } catch (e) {
      if (e instanceof CloudAuthError || e instanceof CloudOfflineError) {
        set('idle', error)
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
