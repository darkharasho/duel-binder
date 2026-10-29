import { GAME_HEADER, gamesOf, type Me } from '../../../shared/cloud'
import { isGameId, type GameId } from '../../../shared/games'
import type { Api } from '../../../shared/ipc'
import type { PortalChannel } from '../../../shared/portal'
import { OFFLINE_MESSAGE } from '../../../shared/friends'
import type { SyncStatus, UpdateStatus } from '../../../shared/types'

export interface HttpApiOptions {
  fetch?: typeof fetch
  /** Called on a 401; the default sends the visitor to the sign-in page. */
  onSignedOut?: () => void
  /** Where the game shown is remembered; defaults to `localStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

/** The `localStorage` key of the game this browser shows. */
export const GAME_KEY = 'duel-binder.game'

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
  blocked: null,
  blockedRetry: null
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
  const storage = (): Pick<Storage, 'getItem' | 'setItem'> => opts.storage ?? localStorage
  const dataListeners = new Set<() => void>()

  /**
   * The game this tab shows, kept in memory so another tab's switch never changes what this one
   * sends. Storage only gives the starting value and remembers the last game for the next load.
   */
  const startGame = ((): GameId => {
    try {
      const value = storage().getItem(GAME_KEY)
      return isGameId(value) ? value : 'ygo'
    } catch {
      // Storage blocked: start on Yu-Gi-Oh!.
      return 'ygo'
    }
  })()
  let current: GameId = 'ygo'
  /** Whether the starting game is settled; Yu-Gi-Oh! is every account's, so it needs no check. */
  let settled = startGame === 'ygo'
  const storeGame = (game: GameId): void => {
    try {
      storage().setItem(GAME_KEY, game)
    } catch {
      // Storage blocked or full: the choice lasts until the page reloads.
    }
  }

  /** The signed-in account's games from `GET /api/me`, asked once; a failed ask is asked again next time. */
  let gamesAsked: Promise<GameId[]> | null = null
  const availableGames = (): Promise<GameId[]> => {
    gamesAsked ??= (async () => {
      let res: Response
      try {
        res = await doFetch('/api/me', { credentials: 'same-origin' })
      } catch {
        throw new Error(OFFLINE_MESSAGE)
      }
      if (res.status === 401) {
        onSignedOut()
        throw new Error('Signed out')
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const me = (await res.json().catch(() => null)) as Me | null
      return gamesOf(me)
    })()
    gamesAsked.catch(() => {
      gamesAsked = null
    })
    return gamesAsked
  }
  /**
   * The game shown. A remembered game other than Yu-Gi-Oh! (an owner's, left in a shared browser)
   * is checked against this account once. Until then the tab shows and sends Yu-Gi-Oh!, and if the
   * check can't be made (offline, a server error) it stays on Yu-Gi-Oh!, so the requests never
   * carry a game the page isn't showing. Storage keeps the remembered game for the next load.
   */
  let settling: Promise<GameId> | null = null
  const activeGame = (): Promise<GameId> => {
    if (settled) return Promise.resolve(current)
    settling ??= (async () => {
      try {
        if ((await availableGames()).includes(startGame)) current = startGame
        else storeGame('ygo')
      } catch {
        // Unchecked: Yu-Gi-Oh!, as the page shows.
      }
      settled = true
      return current
    })()
    return settling
  }
  const setActiveGame = async (game: GameId): Promise<void> => {
    const available = await availableGames()
    if (!isGameId(game) || !available.includes(game))
      throw new Error(`${String(game)} isn't available on this account`)
    await activeGame()
    const before = current
    current = game
    storeGame(game)
    if (game !== before) for (const cb of [...dataListeners]) cb()
  }

  /** POST /api/account/delete with the session cookie; on success the visitor is signed out and leaves. */
  const deleteAccount = async (): Promise<void> => {
    let res: Response
    try {
      res = await doFetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete' }),
        credentials: 'same-origin'
      })
    } catch {
      throw new Error(OFFLINE_MESSAGE)
    }
    if (res.status === 401) {
      onSignedOut()
      throw new Error('Signed out')
    }
    if (!res.ok) throw new Error("Couldn't delete your account")
    onSignedOut()
  }

  const call =
    (channel: PortalChannel) =>
    async (...args: unknown[]): Promise<never> => {
      // The tab's own game, once a remembered one is checked (see activeGame).
      const game = await activeGame()
      let res: Response
      try {
        res = await doFetch(`/api/rpc/${encodeURIComponent(channel).replace('%3A', ':')}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [GAME_HEADER]: game },
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
      printingsByNumber: scanUnavailable,
      printingsForSet: scanUnavailable,
      printingsForCards: scanUnavailable,
      matchName: scanUnavailable,
      cardsForImages: scanUnavailable,
      fingerprints: scanUnavailable,
      refreshFingerprints: scanUnavailable,
      ocr: scanUnavailable,
      language: scanUnavailable
    },
    scanWindow: {
      open: unavailable,
      isOpen: async () => false,
      toggleFullScreen: unavailable,
      send: () => {},
      onMessage: noUnsubscribe,
      onOpenChange: noUnsubscribe
    },
    rip: {
      sets: unavailable,
      start: unavailable,
      openPack: unavailable,
      session: unavailable,
      history: unavailable,
      packWrappers: unavailable
    },
    stats: { get: call('stats:get') },
    // Not on the web (yet): the desktop and phone ask, by printing key, for what their screens show.
    prices: { request: async () => {} },
    usage: {
      report: async (events) => {
        try {
          // keepalive: the last batch is often sent as the tab closes.
          await doFetch('/api/usage', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ platform: 'web', events }),
            credentials: 'same-origin',
            keepalive: true
          })
        } catch {
          // Best effort: a lost batch only undercounts.
        }
      }
    },
    sets: {
      list: call('sets:list'),
      checklist: call('sets:checklist'),
      adjust: call('sets:adjust')
    },
    games: { available: availableGames, active: activeGame, setActive: setActiveGame },
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
      onDataChanged: (cb) => {
        dataListeners.add(cb)
        return () => {
          dataListeners.delete(cb)
        }
      }
    },
    // The web is always signed in through its own session; desktop sign-in and sync don't apply.
    account: {
      status: unavailable,
      signIn: unavailable,
      signOut: unavailable,
      syncNow: unavailable,
      unsynced: unavailable,
      deleteAccount,
      onChange: noUnsubscribe
    }
  }
}
