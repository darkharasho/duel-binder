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

  // jsdom has no layout, so this pins the structure that makes the rows fit: the camera is the one
  // part of the column that shrinks, at 3:4 within whatever room is left, and every other row
  // keeps its height. (Checked by eye in Task 13 at 390x844 and 375x667.)
  it('the camera gives way so the status line, pickers and Review bar always fit', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    const { container } = renderScanner(store)
    const review = await screen.findByRole('button', { name: /0 scanned · Review/ })
    const camera = screen.getByRole('region', { name: 'Camera' })
    const column = camera.parentElement!
    expect(camera).toHaveClass('min-h-0', 'flex-1')

    const stage = camera.querySelector('[data-camera-stage]')!
    expect(stage).toHaveClass('min-h-0', 'flex-1', '[container-type:size]')
    const viewport = container.querySelector('video')!.parentElement!
    expect(stage.contains(viewport)).toBe(true)
    // 3:4 at the largest size that fits the stage, so the scanned crop is what the preview shows.
    expect(viewport).toHaveClass('aspect-[3/4]', 'w-[min(100cqw,75cqh)]')
    // The gear rides on the preview, not on a row of its own.
    expect(viewport.contains(screen.getByRole('button', { name: 'Settings' }))).toBe(true)

    const picker = screen.getByRole('combobox', { name: 'Set' })
    const rows = [...column.children].filter((c) => c !== camera)
    for (const el of [review, picker, screen.getAllByRole('status').at(-1)!]) {
      expect(camera.contains(el)).toBe(false)
      const row = rows.find((r) => r.contains(el))!
      expect(row).toHaveClass('shrink-0')
    }
  })
})
