import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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

const NOTHING: RawSignals = { found: false, quad: null, art: [], codeTexts: [], nameText: null }
const codeFrame = (code: string): RawSignals => ({
  found: true,
  quad,
  art: [],
  codeTexts: [code],
  nameText: null
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) =>
      ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) as ImageData
  } as never)
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

describe('Scan page', () => {
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

  it('a recognized card appears in the list and the status bar', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    renderScan(engine, { scan: { printingsByCode: vi.fn(async () => [printing()]) } })
    expect(screen.getByText('Hold a card up')).toBeInTheDocument()
    expect(
      await screen.findByText(
        'Dark Magician LOB-EN005 · added, lower it to scan the next card',
        undefined,
        { timeout: 4000 }
      )
    ).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'This session' })
    expect(within(list).getByText('Dark Magician')).toBeInTheDocument()
    expect(within(list).getByText('LOB-EN005')).toBeInTheDocument()
    // Held still, it counts once.
    await new Promise((r) => setTimeout(r, 600))
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByLabelText('Quantity of Dark Magician')).toHaveTextContent('1')
  })

  it('rarity dropdown changes the row', async () => {
    stubCamera()
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    renderScan(fakeEngine())
    expect(screen.getByText('Check rarity')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: 'Rarity for Dark Magician' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Rare' }))
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(saved[0]).toMatchObject({ printingId: 102, rarity: 'Rare', flag: null })
    expect(screen.queryByText('Check rarity')).not.toBeInTheDocument()
  })

  it('Add calls collection.add and empties the list', async () => {
    stubCamera()
    localStorage.setItem(SESSION_KEY, JSON.stringify([row({ quantity: 3, flag: null })]))
    const add = vi.fn(async () => ({}) as never)
    renderScan(fakeEngine(), { collection: { add } })
    await userEvent.click(screen.getByRole('button', { name: 'Add 3 cards to collection' }))
    expect(add).toHaveBeenCalledWith({ printingId: 101, imageId: 46986414, quantity: 3 })
    expect(await screen.findByText('Added 3 cards')).toBeInTheDocument()
    expect(screen.queryByText('Dark Magician')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0 cards to collection' })).toBeDisabled()
  })

  it('Add is disabled when no row has a printing', () => {
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
    expect(screen.getByText('Pick printing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 0 cards to collection' })).toBeDisabled()
  })

  it('Clear asks first', async () => {
    stubCamera()
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    renderScan(fakeEngine())
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByText('Dark Magician')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Dark Magician')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear list' })
    )
    await waitFor(() => expect(screen.queryByText('Dark Magician')).not.toBeInTheDocument())
  })

  it('denied camera shows the message and keeps the list', async () => {
    stubCamera('NotAllowedError')
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    renderScan(fakeEngine())
    expect(
      await screen.findByText(
        'Camera access was denied. Allow it in your system settings, then reopen Scan.'
      )
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'One more Dark Magician' }))
    expect(screen.getByLabelText('Quantity of Dark Magician')).toHaveTextContent('2')
  })

  it('no camera shows its message', async () => {
    stubCamera('NotFoundError')
    renderScan(fakeEngine())
    expect(
      await screen.findByText('No camera found. Plug one in and reopen Scan.')
    ).toBeInTheDocument()
  })

  it('camera lost keeps list', async () => {
    const { track } = stubCamera()
    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    const engine = fakeEngine()
    renderScan(engine)
    await waitFor(() => expect(engine.analyze).toHaveBeenCalled(), { timeout: 2000 })
    act(() => track.end())
    expect(
      await screen.findByText("The camera stopped. Check it's connected, then pick it again.")
    ).toBeInTheDocument()
    expect(screen.getByText('Dark Magician')).toBeInTheDocument()
  })

  it('shows the no-fingerprints notice', async () => {
    stubCamera()
    const engine = fakeEngine()
    const { unmount } = renderScan(engine)
    expect(
      await screen.findByText(
        'Artwork matching is unavailable until the artwork data downloads. Set codes and names still work.'
      )
    ).toBeInTheDocument()
    expect(engine.init).toHaveBeenCalledWith(null)
    unmount()

    const fp = new ArrayBuffer(8)
    const ready = fakeEngine()
    renderScan(ready, { scan: { fingerprints: vi.fn(async () => fp) } })
    await waitFor(() => expect(ready.init).toHaveBeenCalledWith(fp))
    expect(screen.queryByText(/Artwork matching is unavailable/)).not.toBeInTheDocument()
  })

  it('picking a set passes its image ids as candidates', async () => {
    stubCamera()
    const lob = { setName: 'Legend of Blue Eyes White Dragon', language: 'en' } as SetSummary
    const lobDe = { setName: 'Legend of Blue Eyes White Dragon', language: 'de' } as SetSummary
    const printingsForSet = vi.fn(async () => [
      printing({ imageIds: [46986414, 46986415] }),
      printing({ printingId: 103, cardId: 2, imageIds: [89631139] })
    ])
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    renderScan(engine, {
      sets: { list: vi.fn(async () => [lob, lobDe]) },
      scan: { printingsForSet }
    })
    await waitFor(() => expect(engine.analyze).toHaveBeenCalled(), { timeout: 2000 })
    expect(engine.analyze.mock.calls[0][1]).toMatchObject({ candidates: null })

    await userEvent.click(screen.getByRole('combobox', { name: 'Set' }))
    await userEvent.click(
      await screen.findByRole('option', { name: 'Legend of Blue Eyes White Dragon · DE' })
    )
    expect(printingsForSet).toHaveBeenCalledWith('Legend of Blue Eyes White Dragon', 'de')
    await waitFor(
      () =>
        expect(engine.analyze.mock.calls.at(-1)?.[1]).toMatchObject({
          candidates: [46986414, 46986415, 89631139]
        }),
      { timeout: 2000 }
    )
    expect(JSON.parse(localStorage.getItem('scan.set')!)).toEqual({
      setName: 'Legend of Blue Eyes White Dragon',
      language: 'de'
    })
  })

  it('re-inits the engine after a failed analysis', async () => {
    stubCamera()
    const engine = fakeEngine((n) => (n === 0 ? new Error('worker died') : NOTHING))
    const { unmount } = renderScan(engine)
    await waitFor(() => expect(engine.analyze.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 4000
    })
    expect(engine.init).toHaveBeenCalledTimes(2)
    unmount()
    expect(engine.dispose).toHaveBeenCalled()
  })

  it('pausing stops analysis', async () => {
    stubCamera()
    const engine = fakeEngine()
    renderScan(engine)
    await waitFor(() => expect(engine.analyze).toHaveBeenCalled(), { timeout: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const calls = engine.analyze.mock.calls.length
    await new Promise((r) => setTimeout(r, 500))
    expect(engine.analyze.mock.calls.length).toBeLessThanOrEqual(calls + 1)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })
})
