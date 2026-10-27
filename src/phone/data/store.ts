import type { SqlDb } from '../../main/db/sql'
import { getMeta, setMeta } from '../../main/db/meta'
import { applyChanges, finishApply } from '../../main/catalog/apply'
import {
  CloudAuthError,
  CloudOfflineError,
  createCloudClient,
  type CloudClient
} from '../../main/cloud/client'
import { syncOnce } from '../../main/cloud/engine'
import {
  accountState,
  activeOwner,
  adoptLocalData,
  applyPending,
  ensureAccount,
  hasLocalData,
  setActiveOwner,
  syncIssueCount
} from '../../main/cloud/localSync'
import { createDataHandlers, DATA_CHANNELS, type DataChannel } from '../../main/ipc/dataHandlers'
import { PHONE_TABLES } from '../../shared/catalogFeed'
import type { Me } from '../../shared/cloud'
import { FRIENDS_SIGNED_OUT, OFFLINE_MESSAGE } from '../../shared/friends'
import type { PortalChannel } from '../../shared/portal'
import { decodeFingerprints } from '../../shared/scan/fingerprintFile'
import type { FingerprintStatus } from '../../shared/scan/types'
import type { CollectionStats, UnsyncedEntry } from '../../shared/types'
import { PHONE_FORMAT } from './phoneSchema'

export type PhoneAccount = { state: 'signed-out' } | { state: 'signed-in'; user: Me }

export interface CatalogState {
  /** First run is done: the catalog is downloaded and the collection has synced once since. */
  filled: boolean
  /** Seq of the last catalog change applied. */
  cursor: number
  /** The server's newest catalog seq when last asked; null before the first page. */
  latest: number | null
  lastSyncAt: string | null
  dbVersion: string | null
}

export interface PhoneSyncState {
  /** The shown account's entries not yet on the server (adds, edits and removals). */
  waiting: number
  /** The shown account's entries the server can't take. */
  problems: number
  lastSyncedAt: string | null
  signedOut: boolean
}

export interface PhoneStore {
  account(): Promise<PhoneAccount>
  signIn(token: string, user: Me): Promise<void>
  signOut(): Promise<{ waiting: number }>
  deleteAccount(): Promise<void>
  catalog(): Promise<CatalogState>
  fillCatalog(onProgress: (p: { cursor: number; latest: number }) => void): Promise<void>
  updateCatalog(opts?: { force?: boolean }): Promise<boolean>
  /** Syncs the shown account; `changed` tells whether anything the user can see may have changed. */
  sync(): Promise<PhoneSyncState & { changed: boolean }>
  syncState(): Promise<PhoneSyncState>
  syncProblems(): Promise<UnsyncedEntry[]>
  invoke(channel: DataChannel, args: unknown[]): Promise<unknown>
  portal<T>(channel: PortalChannel, args: unknown[]): Promise<T>
  fingerprints(): Promise<ArrayBuffer | null>
  refreshFingerprints(opts?: { force?: boolean }): Promise<FingerprintStatus>
}

/**
 * Keys in `phone_state`:
 * - `token`: the Bearer token; absent when signed out.
 * - `user`: the signed-in `Me` as JSON (kept after a sign-out, for the account's name).
 * - `format`: the phone data format (see PHONE_FORMAT).
 * - `catalog_loaded`: '1' once the catalog download has reached the end of the feed.
 * - `catalog_filled`: '1' once a sync has succeeded after that: first run is done.
 * - `catalog_latest`: the server's newest catalog seq at the last page.
 * - `catalog_needs_finish`: '1' while committed card changes wait for the search index rebuild.
 */
type StateKey =
  | 'token'
  | 'user'
  | 'format'
  | 'catalog_loaded'
  | 'catalog_filled'
  | 'catalog_latest'
  | 'catalog_needs_finish'
  | 'history_pulled'

const DAY_MS = 24 * 60 * 60 * 1000
/** The revoke on sign-out is best effort and gives up after this long. */
const REVOKE_TIMEOUT_MS = 10_000
/** A portal call the user is waiting on (friends) gives up after this long. */
const PORTAL_TIMEOUT_MS = 15_000
const FINGERPRINTS = 'fingerprints'

/** The catalog tables that are cleared when the phone's data format changes. */
const RESET_TABLES = PHONE_TABLES.filter(
  (t) => t !== 'cards' && t !== 'card_printings' && t !== 'card_images'
)

/**
 * The data channels that only read. They answer at once, even while a sync or a download waits on
 * the network; every other channel (the edits, and any new one) goes through the serial queue.
 */
const READ_CHANNELS: ReadonlySet<DataChannel> = new Set<DataChannel>([
  'cards:search',
  'cards:get',
  'cards:browse',
  'cards:browseFacets',
  'collection:list',
  'collection:forCard',
  'collection:facets',
  'scan:printingsByCode',
  'scan:printingsForSet',
  'scan:printingsForCards',
  'scan:matchName',
  'scan:cardsForImages',
  'stats:get',
  'sets:list',
  'sets:checklist',
  'account:unsynced'
])

/**
 * The phone's data: the account, the card catalog downloaded from the portal's change feed, the
 * collection (through the desktop's data handlers) and its sync, and the scan fingerprints.
 *
 * Writes and network work (sign-in and out, account deletion, the catalog download and update,
 * sync, the fingerprint download and the edits) run through one serial queue, so a catalog fill,
 * a sync and an add never interleave. Reads don't wait for the queue: a slow connection mustn't
 * hold up the scanner or a page. A read runs only while no transaction is open (`inTransaction`,
 * when the database can tell), so it never lands between the statements of a write.
 */
export function createPhoneStore(deps: {
  /** `inTransaction` lets reads wait out an open transaction (see PhoneDb). */
  db: SqlDb & { inTransaction?(): boolean }
  portal: string
  fetch: typeof fetch
  now?: () => Date
}): PhoneStore {
  const { db } = deps
  // Called unbound: the browser's fetch throws "Illegal invocation" when called as a method of `deps`.
  const doFetch = deps.fetch
  const now = deps.now ?? (() => new Date())
  const base = deps.portal.replace(/\/+$/, '')
  const handlers = createDataHandlers({
    db,
    // Waiting edits are counted from the dirty rows; the caller decides when to sync.
    onEdit: () => {}
  })

  let queue: Promise<unknown> = Promise.resolve()
  /** Runs `fn` after every call queued before it, whatever their outcome. */
  function serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  /** Runs a read now, or as soon as no transaction is open; it never waits for the queue. */
  function read<T>(fn: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const attempt = (): void => {
        if (db.inTransaction?.()) {
          setTimeout(attempt, 0)
          return
        }
        try {
          resolve(fn())
        } catch (e) {
          reject(e)
        }
      }
      attempt()
    })
  }

  const getState = (key: StateKey): string | null =>
    (
      db.prepare('SELECT value FROM phone_state WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value ?? null
  const setState = (key: StateKey, value: string): void => {
    db.prepare(
      'INSERT INTO phone_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value)
  }
  const deleteState = (key: StateKey): void => {
    db.prepare('DELETE FROM phone_state WHERE key = ?').run(key)
  }

  const token = (): string | null => getState('token')
  const storedUser = (): Me | null => {
    const raw = getState('user')
    if (raw === null) return null
    try {
      return JSON.parse(raw) as Me
    } catch {
      return null
    }
  }

  const formatCurrent = (): boolean => Number(getState('format') ?? 0) >= PHONE_FORMAT

  const client = (t: string, timeoutMs?: number): CloudClient =>
    createCloudClient({ baseUrl: base, token: t, fetch: doFetch, timeoutMs })

  /** Signed in: a client with the stored token. Signed out: CloudAuthError. */
  const signedInClient = (): CloudClient => {
    const t = token()
    if (t === null) throw new CloudAuthError('Not signed in')
    return client(t)
  }

  /** The server no longer knows the token: forget it, keep every row and the user's name. */
  const serverSignedOut = (): void => deleteState('token')

  /** Runs a call to the portal; a 401 signs the phone out before the error goes on. */
  async function online<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof CloudAuthError) serverSignedOut()
      throw e
    }
  }

  function syncStateNow(): PhoneSyncState {
    const owner = activeOwner(db)
    const waiting =
      owner === 0
        ? 0
        : Number(
            (
              db
                // An entry the server can't take counts only in `problems`.
                .prepare(
                  `SELECT COUNT(*) AS n FROM collection_entries e
                   WHERE e.owner_id = ? AND e.dirty = 1 AND NOT EXISTS (
                     SELECT 1 FROM sync_issues i WHERE i.owner_id = e.owner_id AND i.uid = e.uid)`
                )
                .get(owner) as { n: number }
            ).n
          )
    return {
      waiting,
      problems: owner === 0 ? 0 : syncIssueCount(db, owner),
      lastSyncedAt: owner === 0 ? null : accountState(db, owner).syncedAt,
      signedOut: token() === null
    }
  }

  /**
   * The data format changed: drop the catalog rows no collection entry uses and start the download
   * again from the beginning. Collection rows are never touched.
   */
  function resetOldFormat(): void {
    if (formatCurrent()) return
    db.transaction(() => {
      db.exec(`
        DELETE FROM card_printings WHERE id NOT IN (SELECT printing_id FROM collection_entries);
        DELETE FROM card_images WHERE image_id NOT IN (SELECT image_id FROM collection_entries);
        DELETE FROM cards WHERE id NOT IN (SELECT card_id FROM card_printings)
          AND id NOT IN (SELECT card_id FROM card_images);
      `)
      for (const t of RESET_TABLES) db.exec(`DELETE FROM ${t}`)
      finishApply(db, { applied: 1, cardsChanged: true, imagesChanged: true })
      setMeta(db, 'catalog_cursor', '0')
      for (const k of [
        'catalog_loaded',
        'catalog_filled',
        'catalog_latest',
        'catalog_needs_finish'
      ] as const)
        deleteState(k)
      setState('format', String(PHONE_FORMAT))
    })()
  }

  /**
   * Downloads the change feed for the phone tables from `catalog_cursor` to its end. Each page
   * commits with its cursor, so a failure resumes from the last page that landed. Foreign keys are
   * off meanwhile: a page may hold rows pointing at a row a later page brings (a card changed after
   * its new printings is listed at its later seq). The serial queue keeps every other write out;
   * reads may run between pages, and see each page's rows whole.
   * Returns whether anything changed.
   */
  async function pullCatalog(
    c: CloudClient,
    onProgress: (p: { cursor: number; latest: number }) => void
  ): Promise<boolean> {
    let changed = false
    let cursor = Number(getMeta(db, 'catalog_cursor') ?? 0)
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      for (;;) {
        const page = await c.catalogChanges(cursor, undefined, PHONE_TABLES)
        if (page.more && page.cursor <= cursor)
          throw new Error('The catalog feed stopped advancing')
        db.transaction(() => {
          const r = applyChanges(db, page.changes)
          if (r.applied > 0) changed = true
          if (r.cardsChanged) setState('catalog_needs_finish', '1')
          setMeta(db, 'catalog_cursor', String(page.cursor))
          setState('catalog_latest', String(page.latest))
          if (page.dbVersion !== null) setMeta(db, 'db_version', page.dbVersion)
        })()
        cursor = page.cursor
        onProgress({ cursor, latest: page.latest })
        if (!page.more) break
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
    db.transaction(() => {
      if (getState('catalog_needs_finish') !== null) {
        finishApply(db, { applied: 1, cardsChanged: true, imagesChanged: false })
        deleteState('catalog_needs_finish')
      }
      setMeta(db, 'last_sync_at', now().toISOString())
      setState('catalog_loaded', '1')
    })()
    // Entries pulled before the catalog had their printing can land now.
    if (changed) applyPending(db)
    return changed
  }

  /**
   * One sync of the shown account; a success after the catalog download finishes first run.
   * Resolves whether anything the user can see may have changed.
   */
  async function syncNow(c: CloudClient): Promise<boolean> {
    const owner = activeOwner(db)
    const { changed } = await syncOnce(db, owner, c, now)
    if (getState('catalog_loaded') !== null) setState('catalog_filled', '1')
    const pulled = await pullValueHistory(c, owner)
    return changed || pulled
  }

  /**
   * The account's value history from the portal, at most once a day. The phone records only the
   * days it's used, so on its own the value chart starts the day it was set up. The phone's own
   * days win. Best effort: a failure tries again on the next sync. Resolves whether it added a day.
   */
  async function pullValueHistory(c: CloudClient, owner: number): Promise<boolean> {
    const mark = `${owner}:${now().toISOString().slice(0, 10)}`
    if (getState('history_pulled') === mark) return false
    let history: CollectionStats['valueHistory']
    try {
      history = (await c.rpc<CollectionStats>('stats:get', [])).valueHistory
    } catch {
      return false
    }
    let added = 0
    db.transaction(() => {
      const insert = db.prepare(
        'INSERT OR IGNORE INTO value_snapshots (owner_id, date, total_value, total_cards) VALUES (?, ?, ?, ?)'
      )
      for (const p of history)
        added += insert.run(owner, p.date, p.totalValue, p.totalCards).changes
      setState('history_pulled', mark)
    })()
    return added > 0
  }

  function fingerprintStatus(failed = false): FingerprintStatus {
    const row = db.prepare('SELECT bytes FROM phone_files WHERE name = ?').get(FINGERPRINTS) as
      { bytes: Uint8Array } | undefined
    if (row) {
      try {
        return { state: 'ready', count: decodeFingerprints(row.bytes).count }
      } catch {
        // A bad file counts as none; the next refresh downloads it again.
      }
    }
    return { state: failed ? 'error' : 'missing', count: 0 }
  }

  /** Resolves true when it stored a new file. */
  async function downloadFingerprints(): Promise<boolean> {
    const known = db.prepare('SELECT etag FROM phone_files WHERE name = ?').get(FINGERPRINTS) as
      { etag: string | null } | undefined
    const headers: Record<string, string> =
      known?.etag && fingerprintStatus().state === 'ready' ? { 'If-None-Match': known.etag } : {}
    const res = await doFetch(`${base}/scan/fingerprints`, {
      headers,
      signal: AbortSignal.timeout(30_000)
    })
    if (res.status === 404) return false
    if (res.status === 304 && known) {
      db.prepare('UPDATE phone_files SET checked_at = ? WHERE name = ?').run(
        now().toISOString(),
        FINGERPRINTS
      )
      return false
    }
    if (!res.ok) throw new Error(`Fingerprint download failed (${res.status})`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    decodeFingerprints(bytes)
    db.prepare(
      `INSERT INTO phone_files (name, etag, checked_at, bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET etag = excluded.etag, checked_at = excluded.checked_at,
         bytes = excluded.bytes`
    ).run(FINGERPRINTS, res.headers.get('ETag'), now().toISOString(), bytes)
    return true
  }

  return {
    account: () =>
      read(() => {
        const user = storedUser()
        return token() !== null && user !== null
          ? { state: 'signed-in', user }
          : { state: 'signed-out' }
      }),

    signIn: (newToken, user) =>
      serial(() => {
        db.transaction(() => {
          ensureAccount(db, user.id, user.displayName ?? user.username)
          if (hasLocalData(db)) adoptLocalData(db, user.id)
          setActiveOwner(db, user.id)
          // An account that never synced here pulls its entries before first run is done (see fillCatalog).
          if (accountState(db, user.id).syncedAt === null) deleteState('catalog_filled')
          setState('token', newToken)
          setState('user', JSON.stringify(user))
        })()
      }),

    signOut: () =>
      serial(async () => {
        const old = token()
        if (old !== null) {
          try {
            await client(old, REVOKE_TIMEOUT_MS).revoke()
          } catch {
            // Best effort: offline, the token stays valid on the server until it expires.
          }
          deleteState('token')
        }
        return { waiting: syncStateNow().waiting }
      }),

    deleteAccount: () =>
      serial(async () => {
        const t = token()
        if (t === null) throw new CloudAuthError('Not signed in')
        let res: Response
        try {
          res = await doFetch(`${base}/api/account/delete`, {
            method: 'POST',
            headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
            body: JSON.stringify({ confirm: 'delete' }),
            redirect: 'error',
            signal: AbortSignal.timeout(30_000)
          })
        } catch (e) {
          throw new CloudOfflineError((e as Error | undefined)?.message || undefined)
        }
        if (res.status === 401) {
          serverSignedOut()
          throw new CloudAuthError()
        }
        if (res.status >= 500) throw new CloudOfflineError(`The portal failed (${res.status})`)
        if (!res.ok) throw new Error(`Account deletion failed (${res.status})`)
        const owner = activeOwner(db)
        db.transaction(() => {
          for (const table of [
            'collection_entries',
            'value_snapshots',
            'sync_pending',
            'sync_issues',
            'cloud_accounts'
          ])
            db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).run(owner)
          setActiveOwner(db, 0)
          deleteState('token')
          deleteState('user')
        })()
      }),

    catalog: () =>
      read(() => {
        const latest = getState('catalog_latest')
        return {
          filled: formatCurrent() && getState('catalog_filled') !== null,
          cursor: Number(getMeta(db, 'catalog_cursor') ?? 0),
          latest: latest === null ? null : Number(latest),
          lastSyncAt: getMeta(db, 'last_sync_at'),
          dbVersion: getMeta(db, 'db_version')
        }
      }),

    fillCatalog: (onProgress) =>
      serial(() =>
        online(async () => {
          const c = signedInClient()
          resetOldFormat()
          await pullCatalog(c, onProgress)
          // The user's entries come down before the first scan, so an add raises a pulled entry.
          await syncNow(c)
        })
      ),

    updateCatalog: ({ force = false } = {}) =>
      serial(() =>
        online(async () => {
          if (token() === null || !formatCurrent() || getState('catalog_loaded') === null)
            return false
          const last = Date.parse(getMeta(db, 'last_sync_at') ?? '')
          if (!force && !Number.isNaN(last) && now().getTime() - last < DAY_MS) return false
          return pullCatalog(signedInClient(), () => {})
        })
      ),

    sync: () =>
      serial(async () => {
        let changed = false
        if (token() !== null) {
          try {
            changed = await online(() => syncNow(signedInClient()))
          } catch (e) {
            if (!(e instanceof CloudAuthError) && !(e instanceof CloudOfflineError)) throw e
          }
        }
        return { ...syncStateNow(), changed }
      }),

    syncState: () => read(syncStateNow),

    // The same handler as the account:unsynced data channel, so both always agree.
    syncProblems: () => read(() => handlers['account:unsynced']() as Promise<UnsyncedEntry[]>),

    invoke: (channel, args) => {
      if (!(DATA_CHANNELS as readonly string[]).includes(channel))
        return Promise.reject(new Error(`Unknown data channel: ${String(channel)}`))
      return (READ_CHANNELS.has(channel) ? read : serial)(() => handlers[channel](...args))
    },

    portal: <T>(channel: PortalChannel, args: unknown[]) =>
      serial(() =>
        online(async () => {
          const t = token()
          if (t === null) throw new Error(FRIENDS_SIGNED_OUT)
          try {
            return await client(t, PORTAL_TIMEOUT_MS).rpc<T>(channel, args)
          } catch (e) {
            if (e instanceof CloudOfflineError) throw new CloudOfflineError(OFFLINE_MESSAGE)
            throw e
          }
        })
      ),

    fingerprints: () =>
      read(() => {
        const row = db.prepare('SELECT bytes FROM phone_files WHERE name = ?').get(FINGERPRINTS) as
          { bytes: Uint8Array } | undefined
        if (!row || fingerprintStatus().state !== 'ready') return null
        return row.bytes.slice().buffer as ArrayBuffer
      }),

    refreshFingerprints: ({ force = false } = {}) =>
      serial(async () => {
        const checked = db
          .prepare('SELECT checked_at FROM phone_files WHERE name = ?')
          .get(FINGERPRINTS) as { checked_at: string } | undefined
        const ready = fingerprintStatus().state === 'ready'
        if (!force && ready && checked && now().getTime() - Date.parse(checked.checked_at) < DAY_MS)
          return fingerprintStatus()
        try {
          return (await downloadFingerprints())
            ? { ...fingerprintStatus(), updated: true as const }
            : fingerprintStatus()
        } catch {
          return fingerprintStatus(true)
        }
      })
  }
}
