import { vi } from 'vitest'
import type { DataChannel } from '../../src/main/ipc/dataHandlers'
import { createPhoneApi, createPhoneEvents, type PhoneEvents } from '../../src/phone/api'
import type {
  CatalogState,
  PhoneAccount,
  PhoneStore,
  PhoneSyncState
} from '../../src/phone/data/store'
import type { Me } from '../../src/shared/cloud'
import type { Api } from '../../src/shared/ipc'
import type { Ocr } from '../../src/shared/scan/ocr'
import type { DeepPartial } from './mockApi'
import { createMockApi } from './mockApi'

export const SETO: Me = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }

/** A few rows for the pages to show. */
const FIXTURES: DeepPartial<Api> = {
  stats: {
    get: vi.fn(async () => ({
      totalCards: 3,
      uniqueCards: 2,
      totalValue: 12.5,
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
  sets: {
    list: vi.fn(async () => [
      {
        language: 'en',
        setName: 'Legend of Blue Eyes White Dragon',
        setCode: 'LOB',
        tcgDate: '2002-03-08',
        imageKey: null,
        packImageKey: null,
        logoImageKey: null,
        coverImageId: null,
        totalCards: 126,
        ownedCards: 2,
        totalRarities: 5,
        ownedRarities: 1,
        listRows: null,
        unmatchedRows: null
      }
    ])
  }
} as DeepPartial<Api>

export interface FakeStoreState {
  account: PhoneAccount
  catalog: CatalogState
  sync: PhoneSyncState
}

/**
 * A PhoneStore over plain state. Data channels answer from the desktop renderer tests' mock api
 * (with a few fixture rows), so the desktop pages render as they do in their own tests.
 */
export function fakeStore(
  over: Partial<PhoneStore> = {},
  start: Partial<FakeStoreState> = {}
): PhoneStore & { state: FakeStoreState } {
  const state: FakeStoreState = {
    account: { state: 'signed-in', user: SETO },
    catalog: {
      filled: true,
      cursor: 10,
      latest: 10,
      lastSyncAt: '2026-10-27T10:00:00.000Z',
      dbVersion: 'v1'
    },
    sync: { waiting: 0, problems: 0, lastSyncedAt: null, signedOut: false },
    ...start
  }
  const data = createMockApi(FIXTURES) as unknown as Record<
    string,
    Record<string, (...a: unknown[]) => Promise<unknown>>
  >
  const store: PhoneStore = {
    account: vi.fn(async () => state.account),
    signIn: vi.fn(async (_token: string, user: Me) => {
      state.account = { state: 'signed-in', user }
    }),
    signOut: vi.fn(async () => {
      state.account = { state: 'signed-out' }
      return { waiting: state.sync.waiting }
    }),
    deleteAccount: vi.fn(async () => {
      state.account = { state: 'signed-out' }
    }),
    catalog: vi.fn(async () => state.catalog),
    fillCatalog: vi.fn(async () => {
      state.catalog = { ...state.catalog, filled: true }
    }),
    updateCatalog: vi.fn(async () => false),
    sync: vi.fn(async () => ({ ...state.sync, changed: false, awaitingPrices: false })),
    syncState: vi.fn(async () => state.sync),
    syncProblems: vi.fn(async () => []),
    invoke: vi.fn(async (channel: DataChannel, args: unknown[]) => {
      const [ns, method] = channel.split(':')
      return data[ns][method](...args)
    }),
    portal: vi.fn(async (channel: string) =>
      channel === 'friends:overview' ? { friends: [], incoming: [], blocked: [] } : []
    ) as PhoneStore['portal'],
    requestPrices: vi.fn(async () => 0),
    fingerprints: vi.fn(async () => null),
    refreshFingerprints: vi.fn(async () => ({ state: 'ready' as const, count: 3 })),
    ...over
  }
  return Object.assign(store, { state })
}

export const fakeOcr = (): Ocr => ({
  read: vi.fn(async () => []),
  readText: vi.fn(async () => ({ text: '', confidence: 0 })),
  dispose: vi.fn(async () => {})
})

/** Installs the phone's window.api over store; `afterAdd` is what the edits call. */
export function installPhoneApi(
  store: PhoneStore,
  afterAdd: () => void = () => {}
): { api: Api; events: PhoneEvents } {
  const events = createPhoneEvents()
  const api = createPhoneApi({
    store,
    ocr: fakeOcr(),
    triggers: { afterAdd, afterPriceRequest: () => {} },
    events
  })
  window.api = api
  return { api, events }
}

/** Answers same-origin fetches by path; anything else is a 404. */
export function stubFetch(
  routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const route = routes[path]
    return route ? route(init) : new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Sets what navigator.onLine answers. */
export function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}
