import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccountStatus, SetSummary } from '@shared/types'
import type { ScanPrinting } from '@shared/scan/types'
import App from '@/App'
import { Toaster } from '@/components/ui/sonner'
import type { RawSignals, ScanEngine } from '@/features/scan/engine'
import { ScanPage } from '@/features/scan/ScanPage'
import type { ScanRow } from '@/features/scan/session'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'
import type { Api } from '@shared/ipc'

const SESSION_KEY = 'scan.session.v1'
// Wall-clock time, captured before any test fakes the timers (and performance with them).
const realNow = performance.now.bind(performance)

const printing = (o: Partial<ScanPrinting> = {}): ScanPrinting => ({
  printingId: 101,
  cardId: 1,
  name: 'Dark Magician',
  frameType: 'normal',
  setName: 'Legend of Blue Eyes White Dragon',
  setCode: 'LOB-EN005',
  rarity: 'Ultra Rare',
  language: 'en',
  imageIds: [46986414],
  ...o
})

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

const quad = [
  [10, 10],
  [110, 10],
  [110, 160],
  [10, 160]
] as const

const NOTHING: RawSignals = {
  found: false,
  quad: null,
  art: [],
  codeTexts: [],
  nameText: null,
  cues: null
}
const codeFrame = (code: string): RawSignals => ({
  found: true,
  quad,
  art: [],
  codeTexts: [code],
  nameText: null,
  cues: null
})

type FakeEngine = ScanEngine & {
  init: ReturnType<typeof vi.fn>
  analyze: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

/** Answers frames with `frame(n)` (n counts from 0); text only when asked, as the real one. */
function fakeEngine(frame: (n: number) => RawSignals | Error = () => NOTHING): FakeEngine {
  let n = 0
  return {
    init: vi.fn(async () => undefined),
    analyze: vi.fn(async (_img: ImageData, opts: { wantText: boolean }) => {
      const out = frame(n++)
      if (out instanceof Error) throw out
      return opts.wantText ? out : { ...out, codeTexts: [], nameText: null }
    }),
    dispose: vi.fn()
  } as unknown as FakeEngine
}

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>
  end(): void
}

/** Stubs getUserMedia (resolving, or rejecting with a DOMException name) and the video/canvas bits. */
function stubCamera(fail?: string): { track: FakeTrack; getUserMedia: ReturnType<typeof vi.fn> } {
  const listeners: (() => void)[] = []
  const track = {
    kind: 'video',
    stop: vi.fn(),
    getSettings: () => ({ deviceId: 'cam1' }),
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'ended') listeners.push(cb)
    },
    removeEventListener: () => {},
    end: () => listeners.forEach((cb) => cb())
  }
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] }
  const getUserMedia = vi.fn(async () => {
    if (fail) throw new DOMException('no', fail)
    return stream
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn(async () =>
        fail === 'NotFoundError'
          ? []
          : [{ deviceId: 'cam1', kind: 'videoinput', label: 'Desk webcam', groupId: 'g' }]
      ),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  })
  return { track, getUserMedia }
}

/** The camera frames grabbed, as createImageBitmap(video, x, y, w, h) calls. */
let grabbed: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get: () => 4
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 640
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 480
  })
  grabbed = vi.fn(
    async (_src: unknown, _x: number, _y: number, width: number, height: number) =>
      ({ width, height, close: vi.fn() }) as unknown as ImageBitmap
  )
  vi.stubGlobal('createImageBitmap', grabbed)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

function renderScan(
  engine: FakeEngine,
  overrides: DeepPartial<Api> = {}
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <>
      <ScanPage engineFactory={() => engine} />
      <Toaster />
    </>,
    { api: createMockApi(overrides) }
  )
}

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }
const signedIn: AccountStatus = {
  state: 'idle',
  user: seto,
  localOwner: null,
  lastSyncedAt: null,
  error: null,
  pendingCount: 0
}

const navNames = (): (string | null)[] =>
  within(screen.getByRole('navigation', { name: 'Main' }))
    .getAllByRole('button')
    .map((b) => b.textContent)

describe('Scan nav', () => {
  it('nav shows Scan on desktop between Browse and Friends, not on web', async () => {
    stubCamera()
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
})

/** Runs timers (the scan loop's interval, query and toast scheduling) inside act. */
const run = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const user = (): ReturnType<typeof userEvent.setup> =>
  userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

describe('Scan page', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Testing Library's async wrapper only advances fake timers it believes are Jest's.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a recognized card appears in the list and the status bar', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    renderScan(engine, { scan: { printingsByCode: vi.fn(async () => [printing()]) } })
    expect(screen.getByText('Hold a card up')).toBeInTheDocument()
    await run(1000)
    expect(
      screen.getByText('Dark Magician LOB-EN005 · added, lower it to scan the next card')
    ).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Dark Magician')).toBeInTheDocument()
    expect(within(list).getByText('LOB-EN005')).toBeInTheDocument()
    // Held still, it counts once.
    await run(1000)
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByLabelText('Quantity of Dark Magician')).toHaveTextContent('1')
  })

  it("under Auto, a card's name that looks the same over its frames picks its rarity", async () => {
    stubCamera()
    // A Normal Monster's plain name is black, so one that reads light is a prismatic foil.
    const engine = fakeEngine(() => ({ ...codeFrame('LOB-EN005'), cues: { nameInk: 'light' } }))
    const both = [printing(), printing({ printingId: 102, rarity: 'Secret Rare' })]
    renderScan(engine, { scan: { printingsByCode: vi.fn(async () => both) } })
    await run(1000)
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Dark Magician')).toBeInTheDocument()
    expect(within(list).queryByText('Check rarity')).not.toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 102, rarity: 'Secret Rare', flag: null })
  })

  it("flags the rarity when the name's look changes between frames", async () => {
    stubCamera()
    const engine = fakeEngine((n) => ({
      ...codeFrame('LOB-EN005'),
      cues: { nameInk: n % 2 ? 'light' : 'dark' }
    }))
    const both = [printing(), printing({ printingId: 102, rarity: 'Secret Rare' })]
    renderScan(engine, { scan: { printingsByCode: vi.fn(async () => both) } })
    await run(1000)
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Check rarity')).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 101, rarity: 'Ultra Rare' })
  })

  it('scans the centre crop the preview shows and draws the outline in its space', async () => {
    stubCamera()
    const engine = fakeEngine(() => ({ ...NOTHING, found: true, quad }))
    const { container } = renderScan(engine)
    await run(500)
    // The stubbed camera is 640x480: the preview shows its centre 360x480.
    expect(grabbed).toHaveBeenLastCalledWith(expect.any(HTMLVideoElement), 140, 0, 360, 480)
    const frame = engine.analyze.mock.calls[0][0] as ImageBitmap
    expect([frame.width, frame.height]).toEqual([360, 480])
    const svg = container.querySelector('svg[preserveAspectRatio]')!
    expect(svg).toHaveAttribute('viewBox', '0 0 360 480')
    expect(svg.querySelector('polygon')).toHaveAttribute('points', '10,10 110,10 110,160 10,160')
  })

  it('rarity dropdown changes the row', async () => {
    stubCamera()
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    renderScan(fakeEngine())
    await run()
    expect(screen.getByText('Check rarity')).toBeInTheDocument()
    const u = user()
    await u.click(screen.getByRole('combobox', { name: 'Rarity for Dark Magician' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'LOB-EN005 · Common',
      'LOB-EN005 · Rare'
    ])
    await u.type(screen.getByPlaceholderText('Search code, rarity or set…'), 'rare')
    await u.click(screen.getByRole('option', { name: 'LOB-EN005 · Rare' }))
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 102, rarity: 'Rare', flag: null })
    expect(screen.queryByText('Check rarity')).not.toBeInTheDocument()
  })

  it("a picked printing keeps the card's other printings to choose from", async () => {
    stubCamera()
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
    renderScan(fakeEngine())
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
    stubCamera()
    renderScan(fakeEngine())
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
    stubCamera()
    localStorage.setItem(SESSION_KEY, JSON.stringify([row({ quantity: 3, flag: null })]))
    const add = vi.fn(async () => ({}) as never)
    renderScan(fakeEngine(), { collection: { add } })
    await run()
    await user().click(screen.getByRole('button', { name: 'Add 3 cards to collection' }))
    await run(100)
    expect(add).toHaveBeenCalledWith({ printingId: 101, imageId: 46986414, quantity: 3 })
    expect(screen.getByText('Added 3 cards')).toBeInTheDocument()
    expect(screen.queryByText('Dark Magician')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0 cards to collection' })).toBeDisabled()
  })

  it('Add is disabled when no row has a printing', async () => {
    stubCamera()
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
    renderScan(fakeEngine())
    await run()
    expect(screen.getByText('Pick printing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0 cards to collection' })).toBeDisabled()
  })

  it('Clear asks first', async () => {
    stubCamera()
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    renderScan(fakeEngine())
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

  it('denied camera shows the message and keeps the list', async () => {
    stubCamera('NotAllowedError')
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    renderScan(fakeEngine())
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
    renderScan(fakeEngine())
    await run()
    expect(screen.getByText('No camera found. Plug one in and reopen Scan.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveTextContent('No camera')
  })

  it('camera lost keeps list, and Try again brings the preview back', async () => {
    const { track, getUserMedia } = stubCamera()
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    const engine = fakeEngine()
    renderScan(engine)
    await run(500)
    expect(engine.analyze).toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveTextContent('Desk webcam')
    act(() => track.end())
    expect(
      screen.getByText("The camera stopped. Check it's connected, then pick it again.")
    ).toBeInTheDocument()
    expect(screen.getByText('Dark Magician')).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    await user().click(screen.getByRole('button', { name: 'Try again' }))
    await run()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/The camera stopped/)).not.toBeInTheDocument()
    expect(screen.getByText('Hold a card up')).toBeInTheDocument()
  })

  it('picking the same camera again after it was lost reopens it', async () => {
    const { track, getUserMedia } = stubCamera()
    renderScan(fakeEngine())
    await run()
    act(() => track.end())
    const u = user()
    await u.click(screen.getByRole('combobox', { name: 'Camera' }))
    await u.click(screen.getByRole('option', { name: 'Desk webcam' }))
    await run()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/The camera stopped/)).not.toBeInTheDocument()
  })

  it('shows the no-fingerprints notice', async () => {
    stubCamera()
    const engine = fakeEngine()
    const { unmount } = renderScan(engine)
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
    renderScan(ready, { scan: { fingerprints: vi.fn(async () => fp) } })
    await run()
    expect(ready.init).toHaveBeenCalledWith(fp)
    expect(screen.queryByText(/Artwork matching is unavailable/)).not.toBeInTheDocument()
  })

  it('picking a set passes its image ids as candidates', async () => {
    stubCamera()
    const lob = { setName: 'Legend of Blue Eyes White Dragon', language: 'en' } as SetSummary
    const lobDe = { setName: 'Legend of Blue Eyes White Dragon', language: 'de' } as SetSummary
    const mrd = { setName: 'Metal Raiders', language: 'en' } as SetSummary
    const printingsForSet = vi.fn(async () => [
      printing({ imageIds: [46986414, 46986415] }),
      printing({ printingId: 103, cardId: 2, imageIds: [89631139] })
    ])
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    renderScan(engine, {
      sets: { list: vi.fn(async () => [mrd, lobDe, lob]) },
      scan: { printingsForSet }
    })
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
    stubCamera()
    localStorage.setItem('scan.set', JSON.stringify({ setName: 'Metal Raiders', language: 'en' }))
    const engine = fakeEngine()
    renderScan(engine, {
      scan: {
        printingsForSet: vi.fn(async () => {
          throw new Error('db gone')
        })
      }
    })
    await run(1000)
    expect(
      screen.getByText("Couldn't load this set's cards, so cards are matched against every set.")
    ).toBeInTheDocument()
    expect(engine.analyze.mock.calls.at(-1)?.[1]).toMatchObject({ candidates: null })
  })

  it('re-inits the engine after a failed analysis', async () => {
    stubCamera()
    const engine = fakeEngine((n) => (n === 0 ? new Error('worker died') : NOTHING))
    const { unmount } = renderScan(engine)
    await run(2000)
    expect(engine.analyze.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(engine.init).toHaveBeenCalledTimes(2)
    unmount()
    expect(engine.dispose).toHaveBeenCalled()
  })

  it('stops after repeated failures, keeps stopped across a set change, and Retry resumes', async () => {
    stubCamera()
    let failing = true
    const engine = fakeEngine(() => (failing ? new Error('worker died') : NOTHING))
    renderScan(engine, {
      sets: {
        list: vi.fn(async () => [{ setName: 'Metal Raiders', language: 'en' } as SetSummary])
      }
    })
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

  it('pausing stops analysis', async () => {
    stubCamera()
    const engine = fakeEngine()
    renderScan(engine)
    await run(500)
    expect(engine.analyze).toHaveBeenCalled()
    await user().click(screen.getByRole('button', { name: 'Pause' }))
    const calls = engine.analyze.mock.calls.length
    await run(1000)
    expect(engine.analyze.mock.calls.length).toBe(calls)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('stays responsive with thousands of sets while frames come in', async () => {
    stubCamera()
    const many = Array.from(
      { length: 7500 },
      (_, i) => ({ setName: `Set ${String(i).padStart(4, '0')}`, language: 'en' }) as SetSummary
    )
    const engine = fakeEngine(() => ({ ...NOTHING, found: true, quad }))
    renderScan(engine, { sets: { list: vi.fn(async () => many) } })
    await run()
    // Wall-clock time: the global performance is faked along with the timers.
    const started = realNow()
    await run(2000)
    const elapsed = realNow() - started
    expect(engine.analyze.mock.calls.length).toBeGreaterThanOrEqual(9)
    // Ten frames of updates (about 7 ms here; the old Select took about 570 ms and 5 s to mount).
    // The closed set picker renders none of its 7,500 entries.
    expect(elapsed).toBeLessThan(300)
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
