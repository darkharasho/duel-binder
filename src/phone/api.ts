import { DATA_CHANNELS, type DataChannel } from '../main/ipc/dataHandlers'
import type { Api } from '../shared/ipc'
import type { PortalChannel } from '../shared/portal'
import { cardLanguage } from '../shared/scan/cardLanguage'
import { checkOcrBands, type Ocr } from '../shared/scan/ocr'
import type {
  AccountStatus,
  CollectionFilters,
  EntryView,
  SyncStatus,
  UpdateStatus
} from '../shared/types'
import type { PhoneStore } from './data/store'
// Declares __APP_VERSION__.
import type {} from './globals'

export interface PhoneEventMap {
  /** A sync or catalog update changed something the pages show. */
  dataChanged: void
  syncStatus: SyncStatus
  account: AccountStatus
}
type PhoneEvent = keyof PhoneEventMap

/** The phone's own events, standing in for the desktop's main-to-renderer pushes. */
export interface PhoneEvents {
  on<E extends PhoneEvent>(event: E, cb: (value: PhoneEventMap[E]) => void): () => void
  emit<E extends PhoneEvent>(
    event: E,
    ...value: PhoneEventMap[E] extends void ? [] : [PhoneEventMap[E]]
  ): void
}

export function createPhoneEvents(): PhoneEvents {
  const listeners = new Map<PhoneEvent, Set<(value: unknown) => void>>()
  return {
    on(event, cb) {
      const set = listeners.get(event) ?? new Set()
      listeners.set(event, set)
      const listener = cb as (value: unknown) => void
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    emit(event, ...value) {
      for (const cb of [...(listeners.get(event) ?? [])]) cb(value[0])
    }
  }
}

const NOT_HERE = 'Not in the phone app'
const notHere = (): Promise<never> => Promise.reject(new Error(NOT_HERE))
const noUnsubscribe = (): (() => void) => () => {}
const unavailable = (): Promise<never> => Promise.reject(new Error('Not available on the phone'))

// The phone has no updater; report the quiet state the UI expects, as the web does.
const UPDATE_IDLE: UpdateStatus = { state: 'idle', mode: 'auto', version: null, error: null }

/** The local edits: each one schedules a sync once it lands. */
const EDITS: readonly DataChannel[] = [
  'collection:add',
  'collection:update',
  'collection:remove',
  'sets:adjust'
]

type Fn = (...args: unknown[]) => Promise<unknown>
type NamespaceOf<C> = C extends `${infer N}:${string}` ? N : never
type MethodOf<C, N extends string> = C extends `${N}:${infer M}` ? M : never
type DataNamespace = NamespaceOf<DataChannel>
/** The methods of Api[N] that are data channels. */
type DataPart<N extends DataNamespace> = Pick<Api[N], MethodOf<DataChannel, N> & keyof Api[N]>

/**
 * The phone's `window.api`. Every data channel goes to the store (in the data worker), so a
 * channel added to DATA_CHANNELS is wired here without a change; friends go to the portal through
 * the store; OCR runs on the page; desktop-only parts answer quietly or reject.
 */
export function createPhoneApi(deps: {
  store: PhoneStore
  ocr: Ocr
  triggers: { afterAdd(): void }
  events: PhoneEvents
}): Api {
  const { store, ocr, triggers, events } = deps

  const data = new Map<string, Record<string, Fn>>()
  for (const channel of DATA_CHANNELS) {
    const [ns, method] = channel.split(':')
    const part = data.get(ns) ?? {}
    data.set(ns, part)
    part[method] = EDITS.includes(channel)
      ? async (...args) => {
          const value = await store.invoke(channel, args)
          triggers.afterAdd()
          return value
        }
      : (...args) => store.invoke(channel, args)
  }
  const dataPart = <N extends DataNamespace>(ns: N): DataPart<N> =>
    data.get(ns) as unknown as DataPart<N>

  const portal =
    (channel: PortalChannel) =>
    (...args: unknown[]): Promise<never> =>
      store.portal<never>(channel, args)

  // ---- Catalog status (sync.*) ----
  let catalogRun: { state: SyncStatus['state']; error: string | null } = {
    state: 'idle',
    error: null
  }
  const syncStatus = async (): Promise<SyncStatus> => {
    const c = await store.catalog()
    return {
      ...catalogRun,
      lastSyncAt: c.lastSyncAt,
      dbVersion: c.dbVersion,
      // The phone doesn't count its cards; 0 means the first download hasn't finished.
      cardCount: c.filled ? 1 : 0,
      blocked: null,
      blockedRetry: null
    }
  }
  const emitSyncStatus = async (): Promise<SyncStatus> => {
    const s = await syncStatus()
    events.emit('syncStatus', s)
    return s
  }
  const runCatalogUpdate = async (): Promise<SyncStatus> => {
    catalogRun = { state: 'checking', error: null }
    await emitSyncStatus().catch(() => {})
    try {
      const changed = await store.updateCatalog({ force: true })
      catalogRun = { state: 'idle', error: null }
      if (changed) events.emit('dataChanged')
    } catch (e) {
      catalogRun = { state: 'error', error: e instanceof Error ? e.message : String(e) }
    }
    return emitSyncStatus()
  }

  // ---- Account status (account.*) ----
  let accountRun: { state: 'idle' | 'syncing' | 'error'; error: string | null } = {
    state: 'idle',
    error: null
  }
  const accountStatus = async (): Promise<AccountStatus> => {
    const [account, sync] = await Promise.all([store.account(), store.syncState()])
    const user = account.state === 'signed-in' ? account.user : null
    return {
      state: user === null ? 'signed-out' : accountRun.state,
      user,
      localOwner: user === null ? null : user.displayName || user.username,
      lastSyncedAt: sync.lastSyncedAt,
      error: accountRun.error,
      // The phone has every printing it can show, so nothing waits on its catalog.
      pendingCount: 0,
      unsyncedCount: sync.problems,
      signInRequired: true
    }
  }
  const emitAccount = async (): Promise<AccountStatus> => {
    const s = await accountStatus()
    events.emit('account', s)
    return s
  }
  const syncNow = async (): Promise<AccountStatus> => {
    accountRun = { state: 'syncing', error: null }
    await emitAccount().catch(() => {})
    try {
      const { changed } = await store.sync()
      accountRun = { state: 'idle', error: null }
      if (changed) events.emit('dataChanged')
    } catch (e) {
      accountRun = { state: 'error', error: e instanceof Error ? e.message : String(e) }
    }
    return emitAccount()
  }

  return {
    cards: dataPart('cards'),
    collection: dataPart('collection'),
    friends: {
      overview: portal('friends:overview'),
      request: portal('friends:request'),
      accept: portal('friends:accept'),
      ignore: portal('friends:ignore'),
      remove: portal('friends:remove'),
      block: portal('friends:block'),
      unblock: portal('friends:unblock'),
      // Printing ids differ between the server and the phone, so a friend's entries get no printing scans.
      collection: async (userId: number, f: CollectionFilters) =>
        (await store.portal<EntryView[]>('friends:collection', [userId, f])).map((e) => ({
          ...e,
          originalArt: false
        })),
      facets: portal('friends:facets')
    },
    scan: {
      ...dataPart('scan'),
      fingerprints: () => store.fingerprints(),
      refreshFingerprints: () => store.refreshFingerprints(),
      ocr: async (bands, kind) => {
        if (kind !== 'code' && kind !== 'name') throw new Error(`Unknown OCR kind: ${String(kind)}`)
        checkOcrBands(bands)
        return ocr.read(bands, kind)
      },
      language: async (bands) => {
        checkOcrBands(bands)
        return cardLanguage(ocr, bands)
      }
    },
    scanWindow: {
      open: async () => {},
      isOpen: async () => false,
      toggleFullScreen: async () => {},
      send: () => {},
      onMessage: noUnsubscribe,
      onOpenChange: noUnsubscribe
    },
    rip: {
      sets: unavailable,
      start: unavailable,
      openPack: unavailable,
      session: unavailable,
      history: unavailable
    },
    stats: dataPart('stats'),
    sets: dataPart('sets'),
    sync: {
      status: syncStatus,
      run: runCatalogUpdate,
      onProgress: (cb) => events.on('syncStatus', cb)
    },
    images: { cacheSize: async () => 0, clearCache: async () => {} },
    window: {
      platform: 'phone',
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      onMaximizedChange: noUnsubscribe
    },
    app: {
      version: async () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'),
      openDataFolder: notHere,
      backupDatabase: notHere,
      checkForUpdates: notHere,
      applyUpdate: notHere,
      updateStatus: async () => UPDATE_IDLE,
      onUpdateStatus: noUnsubscribe,
      onDataChanged: (cb) => events.on('dataChanged', cb)
    },
    account: {
      ...dataPart('account'),
      status: accountStatus,
      // The phone signs in from its own sign-in screen (store.signIn).
      signIn: notHere,
      signOut: async () => {
        await store.signOut()
        accountRun = { state: 'idle', error: null }
        return emitAccount()
      },
      syncNow,
      deleteAccount: async () => {
        await store.deleteAccount()
        accountRun = { state: 'idle', error: null }
        await emitAccount().catch(() => {})
      },
      onChange: (cb) => events.on('account', cb)
    }
  }
}
