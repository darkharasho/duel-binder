import type { Api } from '../../../shared/ipc'
import type { PortalChannel } from '../../../shared/portal'
import { OFFLINE_MESSAGE } from '../../../shared/friends'
import type { SyncStatus, UpdateStatus } from '../../../shared/types'

export interface HttpApiOptions {
  fetch?: typeof fetch
  /** Called on a 401; the default sends the visitor to the sign-in page. */
  onSignedOut?: () => void
}

const unavailable = (): Promise<never> => Promise.reject(new Error('Not available on the web'))
const scanUnavailable = (): Promise<never> =>
  Promise.reject(new Error('Scan is only in the desktop app'))
const noUnsubscribe = (): (() => void) => () => {}

// The web has no sync or updater; report the quiet state the UI expects.
const SYNC_IDLE: SyncStatus = {
  state: 'idle',
  lastSyncAt: null,
  dbVersion: null,
  cardCount: 1,
  error: null,
  blocked: null
}
const UPDATE_IDLE: UpdateStatus = { state: 'idle', mode: 'auto', version: null, error: null }

/**
 * An `Api` for the browser: the portal's channels go to the Worker's
 * `POST /api/rpc/:channel`, everything desktop-only is answered locally.
 * Typed as `Api`, so a method added to it fails the build until it is handled here.
 */
export function createHttpApi(opts: HttpApiOptions = {}): Api {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const onSignedOut = opts.onSignedOut ?? ((): void => location.assign('/'))

  const call =
    (channel: PortalChannel) =>
    async (...args: unknown[]): Promise<never> => {
      let res: Response
      try {
        res = await doFetch(`/api/rpc/${encodeURIComponent(channel).replace('%3A', ':')}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ args }),
          credentials: 'same-origin'
        })
      } catch {
        throw new Error(OFFLINE_MESSAGE)
      }
      if (res.status === 401) {
        onSignedOut()
        throw new Error('Signed out')
      }
      const body = (await res.json().catch(() => null)) as {
        result?: unknown
        error?: unknown
      } | null
      if (res.ok && body && 'result' in body) return body.result as never
      throw new Error(
        typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
      )
    }

  return {
    cards: {
      search: call('cards:search'),
      get: call('cards:get'),
      browse: call('cards:browse'),
      browseFacets: call('cards:browseFacets')
    },
    collection: {
      list: call('collection:list'),
      forCard: call('collection:forCard'),
      add: call('collection:add'),
      update: call('collection:update'),
      remove: call('collection:remove'),
      facets: call('collection:facets')
    },
    friends: {
      overview: call('friends:overview'),
      request: call('friends:request'),
      accept: call('friends:accept'),
      ignore: call('friends:ignore'),
      remove: call('friends:remove'),
      block: call('friends:block'),
      unblock: call('friends:unblock'),
      collection: call('friends:collection'),
      facets: call('friends:facets')
    },
    scan: {
      printingsByCode: scanUnavailable,
      printingsForSet: scanUnavailable,
      printingsForCards: scanUnavailable,
      matchName: scanUnavailable,
      cardsForImages: scanUnavailable,
      fingerprints: scanUnavailable,
      refreshFingerprints: scanUnavailable,
      ocr: scanUnavailable
    },
    stats: { get: call('stats:get') },
    sets: {
      list: call('sets:list'),
      checklist: call('sets:checklist'),
      adjust: call('sets:adjust')
    },
    sync: {
      status: async () => SYNC_IDLE,
      run: async () => SYNC_IDLE,
      onProgress: noUnsubscribe
    },
    images: { cacheSize: unavailable, clearCache: unavailable },
    window: {
      platform: 'web',
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      onMaximizedChange: noUnsubscribe
    },
    app: {
      version: async () => 'web',
      openDataFolder: unavailable,
      backupDatabase: unavailable,
      checkForUpdates: async () => UPDATE_IDLE,
      applyUpdate: unavailable,
      updateStatus: async () => UPDATE_IDLE,
      onUpdateStatus: noUnsubscribe,
      onDataChanged: noUnsubscribe
    },
    // The web is always signed in through its own session; desktop sign-in and sync don't apply.
    account: {
      status: unavailable,
      signIn: unavailable,
      signOut: unavailable,
      syncNow: unavailable,
      unsynced: unavailable,
      onChange: noUnsubscribe
    }
  }
}
