import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccountStatus, SetSummary } from '@shared/types'
import type { ScanDraft } from '@shared/scan/types'
import type { ScanWindowSettings, ScanWindowState } from '@shared/scanWindow'
import type { RawSignals } from '@/features/scan/engine'
import App from '@/App'
import { Toaster } from '@/components/ui/sonner'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import { ScanPage } from '@/features/scan/ScanPage'
import type { ScanRow } from '@/features/scan/session'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'
import type { Api } from '@shared/ipc'
import {
  NOTHING,
  codeFrame,
  fakeBridge,
  fakeEngine,
  printing,
  quad,
  stubCamera,
  stubVideo,
  type FakeEngine
} from './scanFakes'

const SESSION_KEY = 'scan.session.v1'
// Wall-clock time, captured before any test fakes the timers (and performance with them).
const realNow = performance.now.bind(performance)

const row = (o: Partial<ScanRow> = {}): ScanRow => ({
  key: '101:46986414',
  cardId: 1,
  name: 'Dark Magician',
  imageId: 46986414,
  printingId: 101,
  setCode: 'LOB-EN005',
  rarity: 'Common',
  options: [printing({ rarity: 'Common' }), printing({ printingId: 102, rarity: 'Rare' })],
  flag: 'check-rarity',
  via: 'code',
  quantity: 1,
  addedAt: 1,
  ...o
})

const draft = (o: Partial<ScanDraft> = {}): ScanDraft => ({
  cardId: 1,
  name: 'Dark Magician',
  imageId: 46986414,
  printingId: 101,
  setCode: 'LOB-EN005',
  rarity: 'Ultra Rare',
  options: [printing()],
  flag: null,
  via: 'code',
  ...o
})

const STATE: ScanWindowState = {
  devices: [{ deviceId: 'cam1', label: 'Desk webcam' }],
  openDeviceId: 'cam1',
  cameraError: null,
  loop: { kind: 'idle' },
  artReady: true,
  setUnreadable: false
}

let bridge: ReturnType<typeof fakeBridge>
/** The camera frames grabbed, as createImageBitmap(video, x, y, w, h) calls. */
let grabbed: ReturnType<typeof vi.fn>
let camera: ReturnType<typeof stubCamera>

beforeEach(() => {
  localStorage.clear()
  bridge = fakeBridge()
  grabbed = stubVideo()
  camera = stubCamera()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

async function renderScan(
  overrides: DeepPartial<Api> = {},
  engine: FakeEngine = fakeEngine()
): Promise<ReturnType<typeof renderWithProviders>> {
  const rendered = renderWithProviders(
    <ScanHubProvider>
      <ScanPage engineFactory={() => engine} />
      <Toaster />
    </ScanHubProvider>,
    { api: createMockApi({ ...overrides, scanWindow: bridge.scanWindow }) }
  )
  // Lets the hub learn whether the scan window is open, so the page settles into its mode.
  await run()
  return rendered
}

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }
const signedIn: AccountStatus = {
  state: 'idle',
  user: seto,
  localOwner: null,
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0,
  signInRequired: true
}

const navNames = (): (string | null)[] =>
  within(screen.getByRole('navigation', { name: 'Main' }))
    .getAllByRole('button')
    .map((b) => b.textContent)

describe('Scan nav', () => {
  it('nav shows Scan on desktop between Browse and Friends, not on web', async () => {
    const { unmount } = renderWithProviders(<App />, {
      api: createMockApi({ account: { status: vi.fn(async () => signedIn) } })
    })
    await screen.findByRole('button', { name: 'Friends' })
    expect(navNames()).toEqual([
      'Dashboard',
      'Collection',
      'Sets',
      'Browse',
      'Scan',
      'Friends',
      'Settings'
    ])
    unmount()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(seto), { status: 200 }))
    )
    renderWithProviders(<App />, { api: createMockApi({ window: { platform: 'web' } }) })
    await screen.findByRole('button', { name: 'Friends' })
    expect(screen.queryByRole('button', { name: 'Scan' })).not.toBeInTheDocument()
  })

  it('a pull counted while on another page is on the list when you come back', async () => {
    bridge = fakeBridge(true)
    renderWithProviders(<App />, {
      api: createMockApi({
        account: { status: vi.fn(async () => signedIn) },
        scanWindow: bridge.scanWindow
      })
    })
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Scan' }))
    await screen.findByRole('heading', { name: 'Scan' })
    await u.click(screen.getByRole('button', { name: 'Collection' }))
    await screen.findByRole('heading', { name: 'Collection' })
    expect(screen.queryByRole('heading', { name: 'Scan' })).not.toBeInTheDocument()

    act(() => bridge.emit({ kind: 'draft', draft: draft() }))
    await u.click(screen.getByRole('button', { name: 'Scan' }))
    await screen.findByRole('heading', { name: 'Scan' })
    expect(screen.getByLabelText('Quantity of Dark Magician')).toHaveTextContent('1')
  })
})

/** Runs timers (queries, toasts, the highlight) inside act. */
const run = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const user = (): ReturnType<typeof userEvent.setup> =>
  userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

const report = (s: Partial<ScanWindowState> = {}): void =>
  act(() => bridge.emit({ kind: 'state', state: { ...STATE, ...s } }))

const openWindow = async (s: Partial<ScanWindowState> = {}): Promise<void> => {
  act(() => bridge.emitOpen(true))
  report(s)
  await run()
}

const sentSettings = (): ScanWindowSettings[] =>
  bridge.sent.flatMap((m) => (m.kind === 'settings' ? [m.settings] : []))
const lastSettings = (): ScanWindowSettings => sentSettings().at(-1)!

describe('Scan page', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Testing Library's async wrapper only advances fake timers it believes are Jest's.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Open scan window opens it, and says Show once open', async () => {
    await renderScan()
    await run()
    const u = user()
    await u.click(screen.getByRole('button', { name: 'Open scan window' }))
    expect(bridge.scanWindow.open).toHaveBeenCalledTimes(1)
    act(() => bridge.emitOpen(true))
    await u.click(screen.getByRole('button', { name: 'Show scan window' }))
    expect(bridge.scanWindow.open).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Open scan window' })).not.toBeInTheDocument()
  })

  it('learns the window is already open on mount, and gives it its settings', async () => {
    bridge = fakeBridge(true)
    localStorage.setItem('scan.defaultRarity', 'Secret Rare')
    await renderScan()
    await run()
    expect(screen.getByRole('button', { name: 'Show scan window' })).toBeInTheDocument()
    expect(lastSettings()).toEqual({
      deviceId: null,
      paused: false,
      set: null,
      defaultRarity: 'Secret Rare',
      hitPrice: 20
    })
  })

  it('a pull from the scan window lands on the list and is highlighted for a moment', async () => {
    await renderScan()
    await openWindow()
    act(() => bridge.emit({ kind: 'draft', draft: draft() }))
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Dark Magician')).toBeInTheDocument()
    expect(within(list).getByLabelText('Quantity of Dark Magician')).toHaveTextContent('1')
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 101, quantity: 1 })
    expect(within(list).getByText('Dark Magician').closest('li')).toHaveClass('bg-emerald-400/10')
    await run(1500)
    expect(within(list).getByText('Dark Magician').closest('li')).not.toHaveClass(
      'bg-emerald-400/10'
    )
    act(() => bridge.emit({ kind: 'draft', draft: draft() }))
    expect(within(list).getByLabelText('Quantity of Dark Magician')).toHaveTextContent('2')
  })

  it('sends settings when the scan window says it is ready, and on every change', async () => {
    const lob = { setName: 'Legend of Blue Eyes White Dragon', language: 'en' } as SetSummary
    await renderScan({ sets: { list: vi.fn(async () => [lob]) } })
    await run()
    const before = sentSettings().length
    act(() => bridge.emit({ kind: 'ready' }))
    expect(sentSettings()).toHaveLength(before + 1)
    expect(lastSettings()).toMatchObject({ set: null, paused: false, hitPrice: 20 })

    await openWindow()
    const u = user()
    await u.click(screen.getByRole('combobox', { name: 'Set' }))
    await u.click(screen.getByRole('option', { name: 'Legend of Blue Eyes White Dragon · EN' }))
    expect(lastSettings().set).toEqual({
      setName: 'Legend of Blue Eyes White Dragon',
      language: 'en'
    })
    expect(JSON.parse(localStorage.getItem('scan.set')!)).toEqual(lastSettings().set)

    await u.click(screen.getByRole('button', { name: 'Pause' }))
    expect(lastSettings().paused).toBe(true)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    // Pause isn't remembered, and ends when the window closes.
    act(() => bridge.emitOpen(false))
    expect(lastSettings().paused).toBe(false)
  })

  it("lists the scan window's cameras; a different pick sends settings only, the current one retries", async () => {
    const devices = [
      { deviceId: 'cam1', label: 'Desk webcam' },
      { deviceId: 'cam2', label: 'Laptop camera' },
      { deviceId: '', label: '' }
    ]
    await renderScan()
    await openWindow({ devices })
    const u = user()
    const picker = screen.getByRole('combobox', { name: 'Camera' })
    expect(picker).toHaveTextContent('Desk webcam')
    await u.click(picker)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Desk webcam',
      'Laptop camera',
      'Camera 3'
    ])
    await u.click(screen.getByRole('option', { name: 'Laptop camera' }))
    expect(lastSettings().deviceId).toBe('cam2')
    // A different camera is opened by the settings change alone.
    expect(bridge.sent.some((m) => m.kind === 'retryCamera')).toBe(false)

    // Picking the current camera again after an error asks the window to retry it.
    report({ devices, cameraError: 'lost', openDeviceId: null })
    await u.click(screen.getByRole('combobox', { name: 'Camera' }))
    await u.click(screen.getByRole('option', { name: 'Laptop camera' }))
    expect(lastSettings().deviceId).toBe('cam2')
    expect(bridge.sent.at(-1)).toEqual({ kind: 'retryCamera' })
  })

  it("shows the scan window's status, camera errors with Try again, and Retry when stopped", async () => {
    await renderScan()
    await openWindow()
    expect(screen.getByRole('status')).toHaveTextContent('Hold a card up')
    report({ openDeviceId: null })
    expect(screen.getByRole('status')).toHaveTextContent('Starting camera…')
    report({ openDeviceId: 'cam1' })
    const u0 = user()
    await u0.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('status')).toHaveTextContent('Paused')
    await u0.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByRole('status')).toHaveTextContent('Hold a card up')
    report({ loop: { kind: 'unsure' } })
    expect(screen.getByText("Couldn't recognize this card")).toBeInTheDocument()
    report({ loop: { kind: 'added', name: 'Dark Magician', setCode: 'LOB-EN005' } })
    expect(
      screen.getByText('Dark Magician LOB-EN005 · added, lower it to scan the next card')
    ).toBeInTheDocument()

    const u = user()
    report({ loop: { kind: 'stopped' } })
    expect(screen.getByText('Scanning stopped after repeated errors.')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(bridge.sent.at(-1)).toEqual({ kind: 'retryScan' })

    report({ cameraError: 'denied', openDeviceId: null })
    expect(
      screen.getByText(
        'Camera access was denied. Allow it in your system settings, then reopen the scan window.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()

    report({ cameraError: 'none', devices: [], openDeviceId: null })
    expect(
      screen.getByText('No camera found. Plug one in and reopen the scan window.')
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Camera' })).toBeDisabled()
    await u.click(screen.getByRole('button', { name: 'Try again' }))
    expect(bridge.sent.at(-1)).toEqual({ kind: 'retryCamera' })

    report({ cameraError: 'lost', openDeviceId: null })
    expect(
      screen.getByText("The camera stopped. Check it's connected, then pick it again.")
    ).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Try again' }))
    expect(bridge.sent.at(-1)).toEqual({ kind: 'retryCamera' })
    expect(screen.queryByText('Hold a card up')).not.toBeInTheDocument()
  })

  it("shows the scan window's notices", async () => {
    await renderScan()
    await openWindow({ setUnreadable: true, artReady: false })
    expect(
      screen.getByText("Couldn't load this set's cards, so cards are matched against every set.")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Artwork matching is unavailable until the artwork data downloads. Set codes and names still work.'
      )
    ).toBeInTheDocument()
    report()
    expect(screen.queryByText(/matched against every set/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Artwork matching is unavailable/)).not.toBeInTheDocument()
  })

  it('with the scan window closed, the page scans in place', async () => {
    const { container } = await renderScan()
    await run()
    expect(container.querySelector('video')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open scan window' })).toBeInTheDocument()
    expect(screen.getByLabelText('Hit price')).toBeInTheDocument()

    // With it open the page is the list and controls, and the window's state is shown.
    await openWindow()
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    // The window's state is gone once it closes.
    act(() => bridge.emitOpen(false))
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })

  it("scans in place if main can't say whether the scan window is open", async () => {
    bridge.scanWindow.isOpen.mockRejectedValueOnce(new Error('no answer'))
    const { container } = await renderScan()
    await run()
    expect(container.querySelector('video')).toBeInTheDocument()
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('opening the scan window stops the page camera first', async () => {
    const { container } = await renderScan()
    await run()
    expect(container.querySelector('video')).toBeInTheDocument()
    expect(camera.track.stop).not.toHaveBeenCalled()
    await user().click(screen.getByRole('button', { name: 'Open scan window' }))
    await run()
    expect(bridge.scanWindow.open).toHaveBeenCalledTimes(1)
    expect(camera.track.stop).toHaveBeenCalled()
    expect(camera.track.stop.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.scanWindow.open.mock.invocationCallOrder[0]
    )
    // The controls view shows, with no preview.
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('goes back to scanning in place if the scan window fails to open', async () => {
    bridge.scanWindow.open.mockRejectedValueOnce(new Error('no window'))
    const { container } = await renderScan()
    await run()
    await user().click(screen.getByRole('button', { name: 'Open scan window' }))
    await run()
    expect(container.querySelector('video')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(camera.getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('closing the scan window brings the page scanner back', async () => {
    bridge = fakeBridge(true)
    const { container } = await renderScan()
    await run()
    expect(container.querySelector('video')).not.toBeInTheDocument()
    // The page never opens the camera while the window has it.
    expect(camera.getUserMedia).not.toHaveBeenCalled()
    act(() => bridge.emitOpen(false))
    await run()
    expect(container.querySelector('video')).toBeInTheDocument()
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('a pull scanned in the page lands on the list and is highlighted', async () => {
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderScan({ scan: { printingsByCode: vi.fn(async () => [printing()]) } }, engine)
    expect(screen.getByText('Hold a card up')).toBeInTheDocument()
    for (let i = 0; i < 20 && !screen.queryByRole('list', { name: 'This session' }); i++)
      await run(100)
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Dark Magician').closest('li')).toHaveClass('bg-emerald-400/10')
    expect(
      screen.getByText('Dark Magician LOB-EN005 · added, lower it to scan the next card')
    ).toBeInTheDocument()
    await run(1500)
    expect(within(list).getByText('Dark Magician').closest('li')).not.toHaveClass(
      'bg-emerald-400/10'
    )
    // Held still, it counts once.
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByLabelText('Quantity of Dark Magician')).toHaveTextContent('1')
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 101, quantity: 1 })
  })

  it('leaving the page stops the camera and the scanning', async () => {
    const engine = fakeEngine()
    const { unmount } = await renderScan({}, engine)
    await run(500)
    expect(engine.analyze).toHaveBeenCalled()
    unmount()
    expect(camera.track.stop).toHaveBeenCalled()
    expect(engine.dispose).toHaveBeenCalled()
  })

  it('a card-shaped thing far from any artwork counts as the card being lowered', async () => {
    // The card, then only the book behind it (frames 6-11), then the card again.
    const book: RawSignals = {
      ...NOTHING,
      found: true,
      quad,
      art: [{ imageId: 999, distance: 120 }]
    }
    const engine = fakeEngine((n) => (n >= 6 && n < 12 ? book : codeFrame('LOB-EN005')))
    await renderScan(
      {
        scan: {
          printingsByCode: vi.fn(async () => [printing()]),
          cardsForImages: vi.fn(async () => [])
        }
      },
      engine
    )
    await run(1200)
    expect(screen.getByLabelText('Quantity of Dark Magician')).toHaveTextContent('1')
    await run(1200)
    expect(screen.queryByText("Couldn't recognize this card")).not.toBeInTheDocument()
    await run(1200)
    expect(screen.getByLabelText('Quantity of Dark Magician')).toHaveTextContent('2')
  })

  it("under Auto, a card's name that looks the same over its frames picks its rarity", async () => {
    // A Normal Monster's plain name is black, so one that reads light and silver is prismatic.
    const engine = fakeEngine(() => ({
      ...codeFrame('LOB-EN005'),
      cues: { nameInk: 'light', nameTint: 'silver' }
    }))
    const both = [
      printing({ rarity: 'Common' }),
      printing({ printingId: 102, rarity: 'Secret Rare' })
    ]
    await renderScan({ scan: { printingsByCode: vi.fn(async () => both) } }, engine)
    await run(1000)
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Dark Magician')).toBeInTheDocument()
    expect(within(list).queryByText('Check rarity')).not.toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 102, rarity: 'Secret Rare', flag: null })
  })

  it('takes an art-matched card in the language its text reads as, reading it once', async () => {
    const textBand = { width: 4, height: 1, data: new Uint8Array(4) }
    const engine = fakeEngine(() => ({
      ...NOTHING,
      found: true,
      quad,
      art: [{ imageId: 46986414, distance: 5 }],
      textBands: [textBand]
    }))
    const language = vi.fn(async () => 'ja' as const)
    await renderScan(
      {
        scan: {
          cardsForImages: vi.fn(async () => [{ imageId: 46986414, cardId: 1 }]),
          printingsForCards: vi.fn(async () => [
            printing(),
            printing({ printingId: 102, setCode: 'LOB-JP005', language: 'ja' })
          ]),
          language
        }
      },
      engine
    )
    await run(1500)
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 102, setCode: 'LOB-JP005', flag: 'pick-printing' })
    expect(language).toHaveBeenCalledTimes(1)
    expect(language).toHaveBeenCalledWith([textBand])
  })

  it("flags the rarity when the name's look changes between frames", async () => {
    const engine = fakeEngine((n) => ({
      ...codeFrame('LOB-EN005'),
      cues: n % 2 ? { nameInk: 'light', nameTint: 'silver' } : { nameInk: 'dark', nameTint: null }
    }))
    const both = [
      printing({ rarity: 'Common' }),
      printing({ printingId: 102, rarity: 'Secret Rare' })
    ]
    await renderScan({ scan: { printingsByCode: vi.fn(async () => both) } }, engine)
    await run(1000)
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Check rarity')).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 101, rarity: 'Common' })
  })

  it('scans the centre crop the preview shows and draws the outline in its space', async () => {
    const engine = fakeEngine(() => ({ ...NOTHING, found: true, quad }))
    const { container } = await renderScan({}, engine)
    await run(500)
    // The stubbed camera is 640x480: the preview shows its centre 360x480.
    expect(grabbed).toHaveBeenLastCalledWith(expect.any(HTMLVideoElement), 140, 0, 360, 480)
    const frame = engine.analyze.mock.calls[0][0] as ImageBitmap
    expect([frame.width, frame.height]).toEqual([360, 480])
    const svg = container.querySelector('svg[preserveAspectRatio]')!
    expect(svg).toHaveAttribute('viewBox', '0 0 360 480')
    expect(svg.querySelector('polygon')).toHaveAttribute('points', '10,10 110,10 110,160 10,160')
  })

  it('draws no outline round a card-shaped thing far from any artwork', async () => {
    const book: RawSignals = {
      ...NOTHING,
      found: true,
      quad,
      art: [{ imageId: 999, distance: 120 }]
    }
    const { container } = await renderScan(
      { scan: { cardsForImages: vi.fn(async () => []) } },
      fakeEngine(() => book)
    )
    await run(500)
    expect(container.querySelector('svg[preserveAspectRatio] polygon')).toBeNull()
  })

  it('denied camera shows the message and keeps the list', async () => {
    stubCamera('NotAllowedError')
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    await renderScan()
    await run()
    expect(
      screen.getByText(
        'Camera access was denied. Allow it in your system settings, then reopen Scan.'
      )
    ).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'One more Dark Magician' }))
    expect(screen.getByLabelText('Quantity of Dark Magician')).toHaveTextContent('2')
  })

  it('no camera shows its message, and the picker still shows', async () => {
    stubCamera('NotFoundError')
    await renderScan()
    await run()
    expect(screen.getByText('No camera found. Plug one in and reopen Scan.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveTextContent('No camera')
  })

  it('camera lost keeps list, and Try again brings the preview back', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    const engine = fakeEngine()
    await renderScan({}, engine)
    await run(500)
    expect(engine.analyze).toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveTextContent('Desk webcam')
    act(() => camera.track.end())
    expect(
      screen.getByText("The camera stopped. Check it's connected, then pick it again.")
    ).toBeInTheDocument()
    expect(screen.getByText('Dark Magician')).toBeInTheDocument()
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1)

    await user().click(screen.getByRole('button', { name: 'Try again' }))
    await run()
    expect(camera.getUserMedia).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/The camera stopped/)).not.toBeInTheDocument()
    expect(screen.getByText('Hold a card up')).toBeInTheDocument()
  })

  it('picking the same camera again after it was lost reopens it', async () => {
    await renderScan()
    await run()
    act(() => camera.track.end())
    const u = user()
    await u.click(screen.getByRole('combobox', { name: 'Camera' }))
    await u.click(screen.getByRole('option', { name: 'Desk webcam' }))
    await run()
    expect(camera.getUserMedia).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/The camera stopped/)).not.toBeInTheDocument()
  })

  it('shows the no-fingerprints notice', async () => {
    const engine = fakeEngine()
    const { unmount } = await renderScan({}, engine)
    await run()
    expect(
      screen.getByText(
        'Artwork matching is unavailable until the artwork data downloads. Set codes and names still work.'
      )
    ).toBeInTheDocument()
    expect(engine.init).toHaveBeenCalledWith(null)
    unmount()

    const fp = new ArrayBuffer(8)
    const ready = fakeEngine()
    await renderScan({ scan: { fingerprints: vi.fn(async () => fp) } }, ready)
    await run()
    expect(ready.init).toHaveBeenCalledWith(fp)
    expect(screen.queryByText(/Artwork matching is unavailable/)).not.toBeInTheDocument()
  })

  it('scans with the file on disk while the fingerprint refresh hangs', async () => {
    const fp = new ArrayBuffer(8)
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderScan(
      {
        scan: {
          fingerprints: vi.fn(async () => fp),
          refreshFingerprints: vi.fn(() => new Promise<never>(() => {})),
          printingsByCode: vi.fn(async () => [printing()])
        }
      },
      engine
    )
    await run(1000)
    expect(engine.init).toHaveBeenCalledWith(fp)
    expect(engine.analyze).toHaveBeenCalled()
    expect(
      within(screen.getByRole('list', { name: 'This session' })).getByText('Dark Magician')
    ).toBeInTheDocument()
  })

  it('gives the engine the new file when a refresh downloads one', async () => {
    const old = new ArrayBuffer(8)
    const fresh = new ArrayBuffer(16)
    let file: ArrayBuffer | null = null
    let finish!: () => void
    const refreshFingerprints = vi.fn(
      () =>
        new Promise<{ state: 'ready'; count: number; updated: true }>((resolve) => {
          finish = () => {
            file = fresh
            resolve({ state: 'ready', count: 2, updated: true })
          }
        })
    )
    file = old
    const engine = fakeEngine()
    await renderScan(
      { scan: { fingerprints: vi.fn(async () => file), refreshFingerprints } },
      engine
    )
    await run(500)
    expect(engine.init.mock.calls).toEqual([[old]])
    finish()
    await run(500)
    expect(engine.init.mock.calls).toEqual([[old], [fresh]])
  })

  it('keeps the engine as it is when a refresh finds nothing new', async () => {
    const engine = fakeEngine()
    await renderScan(
      {
        scan: {
          fingerprints: vi.fn(async () => new ArrayBuffer(8)),
          refreshFingerprints: vi.fn(async () => ({ state: 'ready' as const, count: 2 }))
        }
      },
      engine
    )
    await run(1000)
    expect(engine.init).toHaveBeenCalledTimes(1)
  })

  it('picking a set passes its image ids as candidates', async () => {
    const lob = { setName: 'Legend of Blue Eyes White Dragon', language: 'en' } as SetSummary
    const lobDe = { setName: 'Legend of Blue Eyes White Dragon', language: 'de' } as SetSummary
    const mrd = { setName: 'Metal Raiders', language: 'en' } as SetSummary
    const printingsForSet = vi.fn(async () => [
      printing({ imageIds: [46986414, 46986415] }),
      printing({ printingId: 103, cardId: 2, imageIds: [89631139] })
    ])
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderScan(
      { sets: { list: vi.fn(async () => [mrd, lobDe, lob]) }, scan: { printingsForSet } },
      engine
    )
    await run(500)
    expect(engine.analyze.mock.calls[0][1]).toMatchObject({ candidates: null })

    const u = user()
    await u.click(screen.getByRole('combobox', { name: 'Set' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Any set',
      'Legend of Blue Eyes White Dragon · EN',
      'Legend of Blue Eyes White Dragon · DE',
      'Metal Raiders · EN'
    ])
    await u.type(screen.getByPlaceholderText('Search sets…'), 'blue de')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Legend of Blue Eyes White Dragon · DE'
    ])
    await u.click(screen.getByRole('option', { name: 'Legend of Blue Eyes White Dragon · DE' }))
    await run(500)
    expect(printingsForSet).toHaveBeenCalledWith('Legend of Blue Eyes White Dragon', 'de')
    expect(screen.getByRole('combobox', { name: 'Set' })).toHaveTextContent(
      'Legend of Blue Eyes White Dragon · DE'
    )
    expect(engine.analyze.mock.calls.at(-1)?.[1]).toMatchObject({
      candidates: [46986414, 46986415, 89631139]
    })
    expect(JSON.parse(localStorage.getItem('scan.set')!)).toEqual({
      setName: 'Legend of Blue Eyes White Dragon',
      language: 'de'
    })
  })

  it("a set whose cards can't be read scans as any set and says so", async () => {
    localStorage.setItem('scan.set', JSON.stringify({ setName: 'Metal Raiders', language: 'en' }))
    const engine = fakeEngine()
    await renderScan(
      {
        scan: {
          printingsForSet: vi.fn(async () => {
            throw new Error('db gone')
          })
        }
      },
      engine
    )
    await run(1000)
    expect(
      screen.getByText("Couldn't load this set's cards, so cards are matched against every set.")
    ).toBeInTheDocument()
    expect(engine.analyze.mock.calls.at(-1)?.[1]).toMatchObject({ candidates: null })
  })

  it('re-inits the engine after a failed analysis', async () => {
    const engine = fakeEngine((n) => (n === 0 ? new Error('worker died') : NOTHING))
    const { unmount } = await renderScan({}, engine)
    await run(2000)
    expect(engine.analyze.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(engine.init).toHaveBeenCalledTimes(2)
    unmount()
    expect(engine.dispose).toHaveBeenCalled()
  })

  it('stops after repeated failures, keeps stopped across a set change, and Retry resumes', async () => {
    let failing = true
    const engine = fakeEngine(() => (failing ? new Error('worker died') : NOTHING))
    await renderScan(
      {
        sets: {
          list: vi.fn(async () => [{ setName: 'Metal Raiders', language: 'en' } as SetSummary])
        }
      },
      engine
    )
    await run(30_000)
    expect(screen.getByText('Scanning stopped after repeated errors.')).toBeInTheDocument()
    const calls = engine.analyze.mock.calls.length
    expect(calls).toBe(5)
    await run(5000)
    expect(engine.analyze.mock.calls.length).toBe(calls)

    const u = user()
    await u.click(screen.getByRole('combobox', { name: 'Set' }))
    await u.click(screen.getByRole('option', { name: 'Metal Raiders · EN' }))
    await run(500)
    expect(screen.getByText('Scanning stopped after repeated errors.')).toBeInTheDocument()

    failing = false
    const inits = engine.init.mock.calls.length
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    await run(500)
    expect(engine.init.mock.calls.length).toBe(inits + 1)
    expect(engine.analyze.mock.calls.length).toBeGreaterThan(calls)
    expect(screen.getByText('Hold a card up')).toBeInTheDocument()
  })

  it('stays responsive with thousands of sets while frames come in', async () => {
    const many = Array.from(
      { length: 7500 },
      (_, i) => ({ setName: `Set ${String(i).padStart(4, '0')}`, language: 'en' }) as SetSummary
    )
    const engine = fakeEngine(() => ({ ...NOTHING, found: true, quad }))
    await renderScan({ sets: { list: vi.fn(async () => many) } }, engine)
    await run()
    // Wall-clock time: the global performance is faked along with the timers.
    const started = realNow()
    await run(2000)
    const elapsed = realNow() - started
    expect(engine.analyze.mock.calls.length).toBeGreaterThanOrEqual(9)
    // Ten frames of updates; the closed set picker renders none of its 7,500 entries.
    expect(elapsed).toBeLessThan(300)
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('hit price is remembered and rejects bad input', async () => {
    await renderScan()
    await run()
    const u = user()
    const input = screen.getByLabelText('Hit price')
    expect(input).toHaveValue(20)
    await u.clear(input)
    await u.type(input, '35')
    await u.tab()
    expect(localStorage.getItem('scan.hitPrice')).toBe('35')
    expect(lastSettings().hitPrice).toBe(35)

    for (const bad of ['', 'abc', '0', '-5']) {
      await u.clear(input)
      if (bad) await u.type(input, bad)
      await u.tab()
      expect(input).toHaveValue(35)
    }
    expect(localStorage.getItem('scan.hitPrice')).toBe('35')
    expect(lastSettings().hitPrice).toBe(35)

    // Enter commits too.
    await u.clear(input)
    await u.type(input, '12.5{Enter}')
    expect(lastSettings().hitPrice).toBe(12.5)
    expect(localStorage.getItem('scan.hitPrice')).toBe('12.5')
  })

  it('starts from the remembered set, rarity and hit price', async () => {
    localStorage.setItem('scan.set', JSON.stringify({ setName: 'Metal Raiders', language: 'en' }))
    localStorage.setItem('scan.hitPrice', '50')
    localStorage.setItem('scan.camera', 'cam9')
    await renderScan()
    await run()
    expect(screen.getByRole('combobox', { name: 'Set' })).toHaveTextContent('Metal Raiders · EN')
    expect(screen.getByLabelText('Hit price')).toHaveValue(50)
    act(() => bridge.emit({ kind: 'ready' }))
    expect(lastSettings()).toMatchObject({
      set: { setName: 'Metal Raiders', language: 'en' },
      hitPrice: 50,
      deviceId: 'cam9'
    })
  })

  it('rarity dropdown changes the row', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    await renderScan()
    await run()
    expect(screen.getByText('Check rarity')).toBeInTheDocument()
    const u = user()
    await u.click(screen.getByRole('combobox', { name: 'Rarity for Dark Magician' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'LOB-EN005 · Common',
      'LOB-EN005 · Rare'
    ])
    // The search box has a name of its own, not just a placeholder.
    await u.type(screen.getByRole('combobox', { name: 'Search code, rarity or set…' }), 'rare')
    await u.click(screen.getByRole('option', { name: 'LOB-EN005 · Rare' }))
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 102, rarity: 'Rare', flag: null })
    expect(screen.queryByText('Check rarity')).not.toBeInTheDocument()
  })

  it("a picked printing keeps the card's other printings to choose from", async () => {
    const options = [
      printing({ printingId: 201, setCode: 'LOB-EN005', rarity: 'Ultra Rare' }),
      printing({ printingId: 202, setCode: 'SDY-006', rarity: 'Common', language: 'de' }),
      printing({ printingId: 999, cardId: 7, name: 'Other', setCode: 'XXX-001' })
    ]
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify([
        row({
          key: 'c1:46986414',
          printingId: null,
          setCode: null,
          rarity: null,
          flag: 'pick-printing',
          via: 'art',
          options
        })
      ])
    )
    await renderScan()
    await run()
    const u = user()
    await u.click(screen.getByRole('combobox', { name: 'Rarity for Dark Magician' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'LOB-EN005 · Ultra Rare · EN',
      'SDY-006 · Common · DE'
    ])
    await u.type(screen.getByPlaceholderText('Search code, rarity or set…'), 'sdy')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await u.click(screen.getByRole('option', { name: 'SDY-006 · Common · DE' }))
    await u.click(screen.getByRole('combobox', { name: 'Rarity for Dark Magician' }))
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('New scans as is searchable and remembered', async () => {
    await renderScan()
    await run()
    const u = user()
    const picker = screen.getByRole('combobox', { name: 'New scans as' })
    expect(picker).toHaveTextContent('Auto')
    await u.click(picker)
    await u.type(screen.getByPlaceholderText('Search rarities…'), 'secret')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Secret Rare',
      'Prismatic Secret Rare',
      'Quarter Century Secret Rare'
    ])
    await u.click(screen.getByRole('option', { name: 'Secret Rare' }))
    expect(picker).toHaveTextContent('Secret Rare')
    expect(localStorage.getItem('scan.defaultRarity')).toBe('Secret Rare')
  })

  it('Add calls collection.add and empties the list', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([row({ quantity: 3, flag: null })]))
    const add = vi.fn(async () => ({}) as never)
    await renderScan({ collection: { add } })
    await run()
    await user().click(screen.getByRole('button', { name: 'Add 3 cards to collection' }))
    await run(100)
    expect(add).toHaveBeenCalledWith({ printingId: 101, imageId: 46986414, quantity: 3 })
    expect(screen.getByText('Added 3 cards')).toBeInTheDocument()
    expect(screen.queryByText('Dark Magician')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0 cards to collection' })).toBeDisabled()
  })

  it("a row can't be changed while Add runs", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([row({ quantity: 2, flag: null })]))
    let finish!: () => void
    const add = vi.fn(() => new Promise<never>((resolve) => (finish = () => resolve({} as never))))
    await renderScan({ collection: { add } })
    await run()
    const controls = (): HTMLElement[] => [
      screen.getByRole('combobox', { name: 'Rarity for Dark Magician' }),
      screen.getByRole('button', { name: 'One fewer Dark Magician' }),
      screen.getByRole('button', { name: 'One more Dark Magician' }),
      screen.getByRole('button', { name: 'Remove Dark Magician' })
    ]
    controls().forEach((c) => expect(c).toBeEnabled())
    await user().click(screen.getByRole('button', { name: 'Add 2 cards to collection' }))
    await run()
    expect(add).toHaveBeenCalledTimes(1)
    controls().forEach((c) => expect(c).toBeDisabled())
    finish()
    await run(100)
    expect(screen.queryByText('Dark Magician')).not.toBeInTheDocument()
  })

  it('Add is disabled when no row has a printing', async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify([
        row({
          key: 'c1:46986414',
          printingId: null,
          setCode: null,
          rarity: null,
          flag: 'pick-printing'
        })
      ])
    )
    await renderScan()
    await run()
    expect(screen.getByText('Check printing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0 cards to collection' })).toBeDisabled()
  })

  it('Clear asks first', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    await renderScan()
    await run()
    const u = user()
    await u.click(screen.getByRole('button', { name: 'Clear' }))
    const dialog = screen.getByRole('dialog')
    expect(screen.getByText('Dark Magician')).toBeInTheDocument()
    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await run(500)
    expect(screen.getByText('Dark Magician')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Clear' }))
    await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear list' }))
    await run(500)
    expect(screen.queryByText('Dark Magician')).not.toBeInTheDocument()
  })

  it('stays responsive with thousands of sets while pulls come in', async () => {
    const many = Array.from(
      { length: 7500 },
      (_, i) => ({ setName: `Set ${String(i).padStart(4, '0')}`, language: 'en' }) as SetSummary
    )
    await renderScan({ sets: { list: vi.fn(async () => many) } })
    await openWindow()
    // Wall-clock time: the global performance is faked along with the timers.
    const started = realNow()
    for (let i = 0; i < 50; i++) {
      act(() =>
        bridge.emit({
          kind: 'draft',
          draft: draft({ cardId: i + 1, printingId: 1000 + i, imageId: 5000 + i })
        })
      )
    }
    await run(2000)
    const elapsed = realNow() - started
    expect(
      within(screen.getByRole('list', { name: 'This session' })).getAllByRole('listitem')
    ).toHaveLength(50)
    // Fifty pulls' updates; the closed set picker renders none of its 7,500 entries.
    expect(elapsed).toBeLessThan(2000)
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
