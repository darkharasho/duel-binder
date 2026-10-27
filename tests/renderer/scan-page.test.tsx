import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccountStatus, SetSummary } from '@shared/types'
import type { ScanDraft } from '@shared/scan/types'
import type { ScanWindowSettings, ScanWindowState } from '@shared/scanWindow'
import App from '@/App'
import { Toaster } from '@/components/ui/sonner'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import { ScanPage } from '@/features/scan/ScanPage'
import type { ScanRow } from '@/features/scan/session'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'
import type { Api } from '@shared/ipc'
import { fakeBridge, printing } from './scanFakes'

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

beforeEach(() => {
  localStorage.clear()
  bridge = fakeBridge()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

function renderScan(overrides: DeepPartial<Api> = {}): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ScanHubProvider>
      <ScanPage />
      <Toaster />
    </ScanHubProvider>,
    { api: createMockApi({ ...overrides, scanWindow: bridge.scanWindow }) }
  )
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
    const { container } = renderWithProviders(<App />, {
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
    expect(container).toBeTruthy()
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
    renderScan()
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
    renderScan()
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
    renderScan()
    await run()
    act(() => bridge.emit({ kind: 'draft', draft: draft() }))
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Dark Magician')).toBeInTheDocument()
    expect(within(list).getByLabelText('Quantity of Dark Magician')).toHaveTextContent('1')
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 101, quantity: 1 })
    act(() => bridge.emit({ kind: 'draft', draft: draft() }))
    expect(within(list).getByLabelText('Quantity of Dark Magician')).toHaveTextContent('2')
  })

  it('sends settings when the scan window says it is ready, and on every change', async () => {
    const lob = { setName: 'Legend of Blue Eyes White Dragon', language: 'en' } as SetSummary
    renderScan({ sets: { list: vi.fn(async () => [lob]) } })
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

  it("lists the scan window's cameras, and picking one sends it and asks it to retry", async () => {
    renderScan()
    await openWindow({
      devices: [
        { deviceId: 'cam1', label: 'Desk webcam' },
        { deviceId: '', label: '' }
      ]
    })
    const u = user()
    const picker = screen.getByRole('combobox', { name: 'Camera' })
    expect(picker).toHaveTextContent('Desk webcam')
    await u.click(picker)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Desk webcam',
      'Camera 2'
    ])
    await u.click(screen.getByRole('option', { name: 'Camera 2' }))
    expect(lastSettings().deviceId).toBeNull()
    expect(bridge.sent.at(-1)).toEqual({ kind: 'retryCamera' })
  })

  it("shows the scan window's status, camera errors with Try again, and Retry when stopped", async () => {
    renderScan()
    await openWindow()
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
    renderScan()
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

  it('says the scan window is closed, and Pause is disabled', async () => {
    renderScan()
    await run()
    expect(
      screen.getByText('The scan window is closed. Open it to start scanning.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Camera' })).toBeDisabled()

    await openWindow()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(screen.queryByText(/The scan window is closed/)).not.toBeInTheDocument()
    // The window's state is gone once it closes.
    act(() => bridge.emitOpen(false))
    expect(screen.getByText(/The scan window is closed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
  })

  it('hit price is remembered and rejects bad input', async () => {
    renderScan()
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
    renderScan()
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
    renderScan()
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
    renderScan()
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
    renderScan()
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
    renderScan({ collection: { add } })
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
    renderScan({ collection: { add } })
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
    renderScan()
    await run()
    expect(screen.getByText('Check printing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0 cards to collection' })).toBeDisabled()
  })

  it('Clear asks first', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    renderScan()
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
    renderScan({ sets: { list: vi.fn(async () => many) } })
    await run()
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
