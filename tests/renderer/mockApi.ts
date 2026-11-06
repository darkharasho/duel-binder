import { vi } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Api } from '@shared/ipc'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K] : DeepPartial<T[K]>
}

const signedOut = {
  state: 'signed-out',
  user: null,
  localOwner: null,
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0,
  signInRequired: true
} as const

const emptyStatus = {
  state: 'idle',
  lastSyncAt: null,
  dbVersion: null,
  cardCount: 1,
  error: null,
  blocked: null,
  blockedRetry: null
} as const

export function createMockApi(overrides: DeepPartial<Api> = {}): Api {
  const base = {
    cards: {
      search: vi.fn(async () => []),
      get: vi.fn(async () => null),
      browse: vi.fn(async () => ({ cards: [], total: 0 })),
      traditionalArt: vi.fn(async () => []),
      japaneseArt: vi.fn(async () => []),
      browseFacets: vi.fn(async () => ({
        cardTypes: [],
        attributes: [],
        races: [],
        archetypes: [],
        setNames: [],
        rarities: [],
        languages: []
      }))
    },
    collection: {
      list: vi.fn(async () => []),
      forCard: vi.fn(async () => []),
      add: vi.fn(async () => {
        throw new Error('collection.add not mocked')
      }),
      update: vi.fn(async () => {
        throw new Error('collection.update not mocked')
      }),
      remove: vi.fn(async () => undefined),
      facets: vi.fn(async () => ({
        cardTypes: [],
        attributes: [],
        archetypes: [],
        setNames: [],
        rarities: [],
        languages: []
      }))
    },
    dex: {
      preview: vi.fn(async () => ({
        copies: 0,
        printings: 0,
        alreadyOwned: 0,
        zeroRows: 0,
        repeatRows: 0,
        notImported: []
      })),
      apply: vi.fn(async () => ({ copies: 0 })),
      copy: vi.fn(async () => undefined)
    },
    placeholders: { save: vi.fn(async () => null) },
    friends: {
      overview: vi.fn(async () => ({ friends: [], incoming: [], blocked: [] })),
      request: vi.fn(async () => ({ status: 'sent' as const })),
      accept: vi.fn(async () => undefined),
      ignore: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      block: vi.fn(async () => undefined),
      unblock: vi.fn(async () => undefined),
      collection: vi.fn(async () => []),
      stats: vi.fn(async () => ({
        totalCards: 0,
        uniqueCards: 0,
        totalValue: 0,
        approximateCount: 0,
        byRarity: [],
        byFrameType: [],
        topEntries: [],
        topSingles: [],
        recentEntries: [],
        valueHistory: [],
        pricesUpdatedAt: null,
        sharedCards: 0
      })),
      sets: vi.fn(async () => []),
      checklist: vi.fn(async () => null),
      forCard: vi.fn(async () => []),
      facets: vi.fn(async () => ({
        cardTypes: [],
        attributes: [],
        archetypes: [],
        setNames: [],
        rarities: [],
        languages: []
      })),
      wishlist: vi.fn(async () => []),
      binders: vi.fn(async () => []),
      sessions: vi.fn(async () => []),
      binder: vi.fn(async () => null),
      wanting: vi.fn(async () => []),
      owning: vi.fn(async () => []),
      wishlistVisible: vi.fn(async () => true),
      setWishlistVisible: vi.fn(async () => undefined)
    },
    wishlist: {
      list: vi.fn(async () => []),
      forCard: vi.fn(async () => []),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    },
    sessions: {
      record: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      setHidden: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined)
    },
    favourites: {
      list: vi.fn(async () => []),
      set: vi.fn(async () => undefined)
    },
    scan: {
      printingsByCode: vi.fn(async () => []),
      printingsByNumber: vi.fn(async () => []),
      printingsForSet: vi.fn(async () => []),
      printingsForCards: vi.fn(async () => []),
      matchName: vi.fn(async () => null),
      cardsForImages: vi.fn(async () => []),
      fingerprints: vi.fn(async () => null),
      fingerprintRefs: vi.fn(async () => []),
      fingerprintStatus: vi.fn(async () => ({ state: 'missing' as const, count: 0 })),
      refreshFingerprints: vi.fn(async () => ({ state: 'missing' as const, count: 0 })),
      ocr: vi.fn(async () => []),
      language: vi.fn(async () => null),
      readText: vi.fn(async () => [])
    },
    stats: {
      get: vi.fn(async () => ({
        totalCards: 0,
        uniqueCards: 0,
        totalValue: 0,
        approximateCount: 0,
        byRarity: [],
        byFrameType: [],
        topEntries: [],
        topSingles: [],
        recentEntries: [],
        valueHistory: [],
        pricesUpdatedAt: null
      }))
    },
    prices: {
      request: vi.fn(async () => undefined),
      ebayHidden: vi.fn(async () => false),
      setEbayHidden: vi.fn(async () => {})
    },
    games: {
      available: vi.fn(async () => ['ygo']),
      active: vi.fn(async () => 'ygo'),
      setActive: vi.fn(async () => undefined)
    },
    usage: { report: vi.fn(async () => undefined) },
    training: {
      upload: vi.fn(async () => ({ ok: true as const, summary: null })),
      remove: vi.fn(async () => ({ ok: true as const, summary: null })),
      summary: vi.fn(async () => null),
      serverIds: vi.fn(async () => [])
    },
    errors: { report: vi.fn(async () => undefined), setEnabled: vi.fn(async () => undefined) },
    sets: {
      list: vi.fn(async () => []),
      checklist: vi.fn(async () => null),
      adjust: vi.fn(async () => {
        throw new Error('sets.adjust not mocked')
      })
    },
    sync: {
      status: vi.fn(async () => ({ ...emptyStatus })),
      run: vi.fn(async () => ({ ...emptyStatus })),
      onProgress: vi.fn(() => () => {})
    },
    images: {
      cacheSize: vi.fn(async () => 0),
      clearCache: vi.fn(async () => undefined),
      onDownloads: vi.fn(() => () => {})
    },
    scanWindow: {
      open: vi.fn(async () => undefined),
      isOpen: vi.fn(async () => false),
      toggleFullScreen: vi.fn(async () => undefined),
      setSize: vi.fn(async () => undefined),
      send: vi.fn(),
      onMessage: vi.fn(() => () => {}),
      onOpenChange: vi.fn(() => () => {})
    },
    window: {
      platform: 'linux',
      minimize: vi.fn(async () => undefined),
      toggleMaximize: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      isMaximized: vi.fn(async () => false),
      onMaximizedChange: vi.fn(() => () => {})
    },
    app: {
      version: vi.fn(async () => '0.0.0'),
      openDataFolder: vi.fn(async () => undefined),
      backupDatabase: vi.fn(async () => null),
      saveReplay: vi.fn(async () => null),
      checkForUpdates: vi.fn(async () => ({
        state: 'none',
        mode: 'auto',
        version: null,
        error: null
      })),
      applyUpdate: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => ({
        state: 'idle',
        mode: 'auto',
        version: null,
        error: null
      })),
      onUpdateStatus: vi.fn(() => () => {}),
      onDataChanged: vi.fn(() => () => {})
    },
    binders: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      preview: vi.fn(async () => ({ printings: 0, cards: 0, owned: 0, tooBroad: false })),
      save: vi.fn(async () => 'uid'),
      remove: vi.fn(async () => undefined),
      edit: vi.fn(async () => undefined),
      forCard: vi.fn(async () => []),
      fieldValues: vi.fn(async () => [])
    },
    account: {
      status: vi.fn(async () => ({ ...signedOut })),
      signIn: vi.fn(async () => ({ ...signedOut })),
      signOut: vi.fn(async () => ({ ...signedOut })),
      emailAuth: vi.fn(async () => ({ next: 'password' as const, email: '' })),
      emailLinkDiscord: vi.fn(async () => ({ next: 'password' as const, email: '' })),
      claim: vi.fn(async () => ({ next: 'password' as const, email: '' })),
      emailEnabled: vi.fn(async () => false),
      syncNow: vi.fn(async () => ({ ...signedOut })),
      unsynced: vi.fn(async () => []),
      deleteAccount: vi.fn(async () => undefined),
      signIns: vi.fn(async () => [
        { provider: 'discord' as const, addedAt: '2026-10-23T12:00:00.000Z' }
      ]),
      setUsername: vi.fn(async (username: string) => ({
        id: 1,
        username,
        displayName: null,
        avatarUrl: null,
        usernameChosen: true
      })),
      removeSignIn: vi.fn(async () => undefined),
      dismissLinkHint: vi.fn(async () => ({
        id: 1,
        username: 'alice',
        displayName: null,
        avatarUrl: null,
        linkHint: null
      })),
      merge: vi.fn(async () => ({
        id: 1,
        username: 'alice',
        displayName: null,
        avatarUrl: null
      })),
      onChange: vi.fn(() => () => {})
    }
  }
  for (const ns of Object.keys(overrides) as (keyof Api)[]) {
    Object.assign(base[ns], overrides[ns])
  }
  return base as unknown as Api
}

export function renderWithProviders(
  ui: ReactElement,
  { api = createMockApi() }: { api?: Api } = {}
) {
  window.api = api
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement =>
    createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, children))
  const result = render(ui, { wrapper })
  return { api, client, ...result }
}
