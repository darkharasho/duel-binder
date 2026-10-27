import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from '@/components/ui/sonner'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import type { ScanRow } from '@/features/scan/session'
import { PhoneContext } from '../../src/phone/context'
import { ScannerScreen } from '../../src/phone/ScannerScreen'
import { createSyncTriggers } from '../../src/phone/syncTriggers'
import type { PhoneStore } from '../../src/phone/data/store'
import { renderWithProviders } from './mockApi'
import { SETO, fakeStore, installPhoneApi, setOnline } from './phoneFakes'
import { fakeEngine, printing, stubCamera, stubVideo } from './scanFakes'

const SESSION_KEY = 'scan.session.v1'

const row = (o: Partial<ScanRow> = {}): ScanRow => ({
  key: '101:46986414',
  cardId: 1,
  name: 'Dark Magician',
  imageId: 46986414,
  printingId: 101,
  setCode: 'LOB-EN005',
  rarity: 'Ultra Rare',
  options: [printing()],
  flag: null,
  via: 'code',
  quantity: 1,
  addedAt: 1,
  ...o
})

let camera: ReturnType<typeof stubCamera>

beforeEach(() => {
  localStorage.clear()
  stubVideo()
  camera = stubCamera()
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

function renderScanner(store: PhoneStore): ReturnType<typeof renderWithProviders> {
  const engine = fakeEngine()
  return renderWithProviders(
    <PhoneContext.Provider value={{ store, user: SETO, signedOut: () => {} }}>
      <ScanHubProvider>
        <ScannerScreen engineFactory={() => engine} onOpenSettings={() => {}} />
        <Toaster />
      </ScanHubProvider>
    </PhoneContext.Provider>,
    { api: window.api }
  )
}

const settle = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

describe('phone scanner', () => {
  it('Add to collection adds each row through the store and triggers one sync', async () => {
    vi.useFakeTimers()
    // Testing Library's async wrapper only advances fake timers it believes are Jest's.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify([
        row(),
        row({ key: '102:46986414', printingId: 102, setCode: 'SDY-006', quantity: 2 })
      ])
    )
    const store = fakeStore({
      invoke: vi.fn(async (channel: string) => (channel === 'collection:add' ? { id: 1 } : []))
    })
    const { api } = installPhoneApi(store, () => triggers.afterAdd())
    const triggers = createSyncTriggers({
      sync: () => api.account.syncNow(),
      online: () => navigator.onLine,
      on: () => () => {},
      setTimer: setTimeout,
      clearTimer: clearTimeout
    })
    renderScanner(store)
    await settle()

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: /3 scanned · Review/ }))
    const list = screen.getByRole('region', { name: 'This session' })
    await user.click(within(list).getByRole('button', { name: 'Add 3 cards to collection' }))
    await settle()

    const adds = vi.mocked(store.invoke).mock.calls.filter(([c]) => c === 'collection:add')
    expect(adds).toEqual([
      ['collection:add', [{ printingId: 101, imageId: 46986414, quantity: 1 }]],
      ['collection:add', [{ printingId: 102, imageId: 46986414, quantity: 2 }]]
    ])
    expect(store.sync).not.toHaveBeenCalled()
    await settle(2_000)
    expect(store.sync).toHaveBeenCalledTimes(1)
    triggers.dispose()
  })

  it('opens the rear camera', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    renderScanner(store)
    await vi.waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled())
    expect(camera.getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } })
      })
    )
  })

  it('torch button shows only when the track reports torch', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    const first = renderScanner(store)
    await vi.waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Flashlight' })).not.toBeInTheDocument()
    first.unmount()

    const applyConstraints = vi.fn(async () => undefined)
    Object.assign(camera.track, {
      getCapabilities: () => ({ torch: true }),
      applyConstraints
    })
    const user = userEvent.setup()
    renderScanner(store)
    const torch = await screen.findByRole('button', { name: 'Flashlight' })
    expect(torch).toHaveAttribute('aria-pressed', 'false')
    await user.click(torch)
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: true }] })
    expect(torch).toHaveAttribute('aria-pressed', 'true')
    await user.click(torch)
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] })
  })

  it('shows the Set and New scans as pickers and a settings button', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    renderScanner(store)
    expect(await screen.findByRole('combobox', { name: 'Set' })).toHaveTextContent('Any set')
    expect(screen.getByRole('combobox', { name: 'New scans as' })).toHaveTextContent('Auto')
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })
})
