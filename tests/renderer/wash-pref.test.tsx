import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { DEFAULT_PREFS, type Prefs } from '@shared/prefs'
import { useWashPref, resetWashStoreForTests } from '@/lib/washPref'
import { createMockApi } from './mockApi'
import type { Api } from '@shared/ipc'

const ready = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/friends', () => ({ useFriendsReady: () => ready.value }))

const KEY = 'prefs:v1'
const locked: Prefs['wash'] = {
  mode: 'locked',
  locked: { fams: [{ lab: [50, 10, 10], share: 1 }], dark: [20, 0, 0], vivid: 0.5 }
}

let api: Api
let client: QueryClient

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children)

const setup = (over: Partial<Api['prefs']> = {}) => {
  api = createMockApi({ prefs: over })
  window.api = api
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  localStorage.clear()
  resetWashStoreForTests()
  ready.value = false
  setup()
})

afterEach(() => {
  window.api = undefined as never
  localStorage.clear()
})

describe('useWashPref', () => {
  it('defaults with empty storage', () => {
    const { result } = renderHook(() => useWashPref(), { wrapper })
    expect(result.current.wash).toEqual(DEFAULT_PREFS.wash)
  })

  it('gives defaults for corrupt storage', () => {
    localStorage.setItem(KEY, '{not json')
    const { result } = renderHook(() => useWashPref(), { wrapper })
    expect(result.current.wash).toEqual(DEFAULT_PREFS.wash)
  })

  it('uses a stored value on first render', () => {
    localStorage.setItem(KEY, JSON.stringify({ wash: locked }))
    const { result } = renderHook(() => useWashPref(), { wrapper })
    expect(result.current.wash).toEqual(locked)
  })

  it('signed out: setWash updates value and storage and never calls the portal', () => {
    const { result } = renderHook(() => useWashPref(), { wrapper })
    act(() => result.current.setWash({ mode: 'colourless' }))
    expect(result.current.wash).toEqual({ mode: 'colourless' })
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({ wash: { mode: 'colourless' } })
    expect(api.prefs.set).not.toHaveBeenCalled()
    expect(api.prefs.get).not.toHaveBeenCalled()
  })

  it('signed in: a portal value replaces the local one', async () => {
    ready.value = true
    setup({ get: vi.fn(async () => ({ wash: locked })) })
    const { result } = renderHook(() => useWashPref(), { wrapper })
    await waitFor(() => expect(result.current.wash).toEqual(locked))
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({ wash: locked })
  })

  it('signed in: setWash calls prefs.set with the wash and keeps it over a cached result', async () => {
    ready.value = true
    const { result } = renderHook(() => useWashPref(), { wrapper })
    await waitFor(() => expect(api.prefs.get).toHaveBeenCalled())
    await act(async () => result.current.setWash({ mode: 'colourless' }))
    expect(api.prefs.set).toHaveBeenCalledWith({ wash: { mode: 'colourless' } })
    expect(result.current.wash).toEqual({ mode: 'colourless' })
    const second = renderHook(() => useWashPref(), { wrapper })
    result.current.setWash({ mode: 'colourless' })
    second.rerender()
    expect(second.result.current.wash).toEqual({ mode: 'colourless' })
  })

  it('a later instance does not replay an older cached portal value over a signed-out choice', async () => {
    ready.value = true
    setup({ get: vi.fn(async () => ({ wash: locked })) })
    const first = renderHook(() => useWashPref(), { wrapper })
    await waitFor(() => expect(first.result.current.wash).toEqual(locked))
    first.unmount()
    ready.value = false
    const second = renderHook(() => useWashPref(), { wrapper })
    act(() => second.result.current.setWash({ mode: 'colourless' }))
    const third = renderHook(() => useWashPref(), { wrapper })
    expect(third.result.current.wash).toEqual({ mode: 'colourless' })
    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({ wash: { mode: 'colourless' } })
  })

  it('a rejected set keeps the new local value', async () => {
    ready.value = true
    setup({ set: vi.fn(async () => Promise.reject(new Error('offline'))) })
    const { result } = renderHook(() => useWashPref(), { wrapper })
    await waitFor(() => expect(api.prefs.get).toHaveBeenCalled())
    await act(async () => result.current.setWash({ mode: 'colourless' }))
    expect(api.prefs.set).toHaveBeenCalled()
    expect(result.current.wash).toEqual({ mode: 'colourless' })
  })

  it('two instances agree after one calls setWash', () => {
    const a = renderHook(() => useWashPref(), { wrapper })
    const b = renderHook(() => useWashPref(), { wrapper })
    act(() => a.result.current.setWash(locked))
    expect(b.result.current.wash).toEqual(locked)
  })

  it('follows a storage event from another window', () => {
    const { result } = renderHook(() => useWashPref(), { wrapper })
    act(() => {
      localStorage.setItem(KEY, JSON.stringify({ wash: locked }))
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    })
    expect(result.current.wash).toEqual(locked)
  })
})
