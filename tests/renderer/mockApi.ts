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

const emptyStatus = { state: 'idle', lastSyncAt: null, dbVersion: null, cardCount: 1, error: null, blocked: null, blockedRetry: null } as const

export function createMockApi(overrides: DeepPartial<Api> = {}): Api {
  const base = {
    cards: {
      search: vi.fn(async () => []),
      get: vi.fn(async () => null),
      browse: vi.fn(async () => ({ cards: [], total: 0 })),
      browseFacets: vi.fn(async () => ({
        cardTypes: [],
        attributes: [],
        races: [],
        archetypes: [],
        setNames: [],
        rarities: []
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
      facets: vi.fn(async () => ({ cardTypes: [], attributes: [], archetypes: [], setNames: [], rarities: [], languages: [] }))
    },
    friends: {
      overview: vi.fn(async () => ({ friends: [], incoming: [], blocked: [] })),
      request: vi.fn(async () => ({ status: 'sent' as const })),
      accept: vi.fn(async () => undefined),
      ignore: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      block: vi.fn(async () => undefined),
      unblock: vi.fn(async () => undefined),
      collection: vi.fn(async () => []),
      facets: vi.fn(async () => ({ cardTypes: [], attributes: [], archetypes: [], setNames: [], rarities: [], languages: [] }))
    },
    scan: {
      printingsByCode: vi.fn(async () => []),
      printingsForSet: vi.fn(async () => []),
      printingsForCards: vi.fn(async () => []),
      matchName: vi.fn(async () => null),
      cardsForImages: vi.fn(async () => []),
      fingerprints: vi.fn(async () => null),
      refreshFingerprints: vi.fn(async () => ({ state: 'missing' as const, count: 0 })),
      ocr: vi.fn(async () => []),
      language: vi.fn(async () => null)
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
    prices: { request: vi.fn(async () => undefined) },
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
    images: { cacheSize: vi.fn(async () => 0), clearCache: vi.fn(async () => undefined) },
    scanWindow: {
      open: vi.fn(async () => undefined),
      isOpen: vi.fn(async () => false),
      toggleFullScreen: vi.fn(async () => undefined),
      send: vi.fn(),
      onMessage: vi.fn(() => () => {}),
      onOpenChange: vi.fn(() => () => {})
    },
    rip: {
      sets: vi.fn(async () => []),
      start: vi.fn(async () => 1),
      openPack: vi.fn(async () => []),
      session: vi.fn(async () => null),
      history: vi.fn(async () => ({
        packsOpened: 0,
        cardsPulled: 0,
        setsRipped: 0,
        bestPulls: [],
        sessions: []
      })),
      packWrappers: vi.fn(async () => null)
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
      checkForUpdates: vi.fn(async () => ({ state: 'none', mode: 'auto', version: null, error: null })),
      applyUpdate: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => ({ state: 'idle', mode: 'auto', version: null, error: null })),
      onUpdateStatus: vi.fn(() => () => {}),
      onDataChanged: vi.fn(() => () => {})
    },
    account: {
      status: vi.fn(async () => ({ ...signedOut })),
      signIn: vi.fn(async () => ({ ...signedOut })),
      signOut: vi.fn(async () => ({ ...signedOut })),
      syncNow: vi.fn(async () => ({ ...signedOut })),
      unsynced: vi.fn(async () => []),
      deleteAccount: vi.fn(async () => undefined),
      onChange: vi.fn(() => () => {})
    }
  }
  for (const ns of Object.keys(overrides) as (keyof Api)[]) {
    Object.assign(base[ns], overrides[ns])
  }
  return base as unknown as Api
}

export function renderWithProviders(ui: ReactElement, { api = createMockApi() }: { api?: Api } = {}) {
  window.api = api
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): ReactElement =>
    createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, children))
  const result = render(ui, { wrapper })
  return { api, client, ...result }
}
