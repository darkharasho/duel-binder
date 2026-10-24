import { vi } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Api } from '@shared/ipc'
import { createElement, type ReactElement, type ReactNode } from 'react'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K] : DeepPartial<T[K]>
}

const emptyStatus = { state: 'idle', lastSyncAt: null, dbVersion: null, cardCount: 1, error: null } as const

export function createMockApi(overrides: DeepPartial<Api> = {}): Api {
  const base = {
    cards: { search: vi.fn(async () => []), get: vi.fn(async () => null) },
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
      facets: vi.fn(async () => ({ cardTypes: [], attributes: [], archetypes: [], setNames: [], rarities: [] }))
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
        pricesUpdatedAt: null
      }))
    },
    sync: {
      status: vi.fn(async () => ({ ...emptyStatus })),
      run: vi.fn(async () => ({ ...emptyStatus })),
      onProgress: vi.fn(() => () => {})
    },
    images: { cacheSize: vi.fn(async () => 0), clearCache: vi.fn(async () => undefined) },
    app: {
      version: vi.fn(async () => '0.0.0'),
      openDataFolder: vi.fn(async () => undefined),
      backupDatabase: vi.fn(async () => null),
      checkForUpdates: vi.fn(async () => ({ state: 'none', mode: 'auto', version: null, error: null })),
      applyUpdate: vi.fn(async () => undefined),
      updateStatus: vi.fn(async () => ({ state: 'idle', mode: 'auto', version: null, error: null })),
      onUpdateStatus: vi.fn(() => () => {})
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
    createElement(QueryClientProvider, { client }, children)
  const result = render(ui, { wrapper })
  return { api, client, ...result }
}
