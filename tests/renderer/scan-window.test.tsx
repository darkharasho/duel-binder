import { act, screen } from '@testing-library/react'
import type { SetSummary } from '@shared/types'
import type { ScanDraft } from '@shared/scan/types'
import type { ScanWindowSettings, ScanWindowState } from '@shared/scanWindow'
import type { RawSignals } from '@/features/scan/engine'
import { ScanWindowApp } from '@/features/scan/window/ScanWindowApp'
import { FADE_MS, NORMAL_MS } from '@/features/scan/window/overlay'
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

const SETTINGS: ScanWindowSettings = {
  deviceId: null,
  paused: false,
  set: null,
  defaultRarity: null,
  hitPrice: 20
}

let grabbed: ReturnType<typeof vi.fn>
let bridge: ReturnType<typeof fakeBridge>

beforeEach(() => {
  localStorage.clear()
  grabbed = stubVideo()
  bridge = fakeBridge()
  vi.useFakeTimers()
  // Testing Library's async wrapper only advances fake timers it believes are Jest's.
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

/** Runs timers (the scan loop's interval, queries, overlay timers) inside act. */
const run = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

/** Renders the window, and delivers `settings` unless told not to. */
async function renderWindow(
  engine: FakeEngine,
  overrides: DeepPartial<Api> = {},
  settings: Partial<ScanWindowSettings> | null = {}
): Promise<ReturnType<typeof renderWithProviders>> {
  const result = renderWithProviders(<ScanWindowApp engineFactory={() => engine} />, {
    api: createMockApi({ ...overrides, scanWindow: bridge.scanWindow })
  })
  if (settings) {
    act(() => bridge.emit({ kind: 'settings', settings: { ...SETTINGS, ...settings } }))
    await run()
  }
  return result
}

const drafts = (): ScanDraft[] => bridge.sent.flatMap((m) => (m.kind === 'draft' ? [m.draft] : []))

const lastState = (): ScanWindowState => {
  const states = bridge.sent.flatMap((m) => (m.kind === 'state' ? [m.state] : []))
  return states[states.length - 1]
}

const settings = (s: Partial<ScanWindowSettings>): void =>
  act(() => bridge.emit({ kind: 'settings', settings: { ...SETTINGS, ...s } }))

describe('Scan window', () => {
  it('waits for settings before opening the camera', async () => {
    const { getUserMedia } = stubCamera()
    await renderWindow(fakeEngine(), {}, null)
    await run(500)
    expect(bridge.sent).toEqual([{ kind: 'ready' }])
    expect(getUserMedia).not.toHaveBeenCalled()
    // Plain black until then: no text.
    expect(screen.queryByText(/./)).not.toBeInTheDocument()
    settings({})
    await run()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('sets the window title', async () => {
    stubCamera()
    await renderWindow(fakeEngine(), {}, null)
    expect(document.title).toBe('Duel Binder — Scan')
  })

  it('a recognized card is sent as a draft, once while held', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderWindow(engine, { scan: { printingsByCode: vi.fn(async () => [printing()]) } })
    await run(1000)
    expect(drafts()).toHaveLength(1)
    expect(drafts()[0]).toMatchObject({ name: 'Dark Magician', setCode: 'LOB-EN005' })
    await run(1000)
    expect(drafts()).toHaveLength(1)
    expect(lastState().loop).toEqual({ kind: 'added', name: 'Dark Magician', setCode: 'LOB-EN005' })
  })

  it('a card-shaped thing far from any artwork counts as the card being lowered', async () => {
    stubCamera()
    // The card, then only the book behind it (frames 6-11), then the card again.
    const book: RawSignals = {
      ...NOTHING,
      found: true,
      quad,
      art: [{ imageId: 999, distance: 120 }]
    }
    const engine = fakeEngine((n) => (n >= 6 && n < 12 ? book : codeFrame('LOB-EN005')))
    await renderWindow(engine, {
      scan: {
        printingsByCode: vi.fn(async () => [printing()]),
        cardsForImages: vi.fn(async () => [])
      }
    })
    await run(1200)
    expect(drafts()).toHaveLength(1)
    await run(1200)
    expect(lastState().loop.kind).not.toBe('unsure')
    await run(1200)
    expect(drafts()).toHaveLength(2)
  })

  it("under Auto, a card's name that looks the same over its frames picks its rarity", async () => {
    stubCamera()
    // A Normal Monster's plain name is black, so one that reads light and silver is prismatic.
    const engine = fakeEngine(() => ({
      ...codeFrame('LOB-EN005'),
      cues: { nameInk: 'light', nameTint: 'silver' }
    }))
    const both = [
      printing({ rarity: 'Common' }),
      printing({ printingId: 102, rarity: 'Secret Rare' })
    ]
    await renderWindow(engine, { scan: { printingsByCode: vi.fn(async () => both) } })
    await run(1000)
    expect(drafts()[0]).toMatchObject({ printingId: 102, rarity: 'Secret Rare', flag: null })
  })

  it("flags the rarity when the name's look changes between frames", async () => {
    stubCamera()
    const engine = fakeEngine((n) => ({
      ...codeFrame('LOB-EN005'),
      cues: n % 2 ? { nameInk: 'light', nameTint: 'silver' } : { nameInk: 'dark', nameTint: null }
    }))
    const both = [
      printing({ rarity: 'Common' }),
      printing({ printingId: 102, rarity: 'Secret Rare' })
    ]
    await renderWindow(engine, { scan: { printingsByCode: vi.fn(async () => both) } })
    await run(1000)
    expect(drafts()[0]).toMatchObject({ printingId: 101, rarity: 'Common', flag: 'check-rarity' })
  })

  it('scans the centre crop and draws the outline in video space', async () => {
    stubCamera()
    const engine = fakeEngine(() => ({ ...NOTHING, found: true, quad }))
    const { container } = await renderWindow(engine)
    await run(500)
    // The stubbed camera is 640x480: the centre 360x480 is scanned.
    expect(grabbed).toHaveBeenLastCalledWith(expect.any(HTMLVideoElement), 140, 0, 360, 480)
    const frame = engine.analyze.mock.calls[0][0] as ImageBitmap
    expect([frame.width, frame.height]).toEqual([360, 480])
    // The quad is in crop pixels; the crop starts 140 px into the video.
    const svg = container.querySelector('svg[preserveAspectRatio]')!
    expect(svg).toHaveAttribute('viewBox', '0 0 640 480')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice')
    expect(svg.querySelector('polygon')).toHaveAttribute('points', '150,10 250,10 250,160 150,160')
    expect(svg.querySelector('polygon')).toHaveAttribute('stroke', '#34d399')
  })

  it('draws no outline round a card-shaped thing far from any artwork', async () => {
    stubCamera()
    const book: RawSignals = {
      ...NOTHING,
      found: true,
      quad,
      art: [{ imageId: 999, distance: 120 }]
    }
    const { container } = await renderWindow(
      fakeEngine(() => book),
      { scan: { cardsForImages: vi.fn(async () => []) } }
    )
    await run(500)
    expect(container.querySelector('svg[preserveAspectRatio] polygon')).toBeNull()
  })

  it('the video fills the window, is not mirrored, and double-click toggles full screen', async () => {
    stubCamera()
    const { container } = await renderWindow(fakeEngine())
    const video = container.querySelector('video')!
    expect(video).toHaveClass('object-cover')
    expect(video.className).not.toMatch(/scale-x|-scale/)
    expect(video.style.transform).toBe('')
    act(() => {
      video.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(bridge.scanWindow.toggleFullScreen).toHaveBeenCalledTimes(1)
  })

  it('shows the no-fingerprints state and gives the engine the file', async () => {
    stubCamera()
    const engine = fakeEngine()
    const { unmount } = await renderWindow(engine)
    await run()
    expect(engine.init).toHaveBeenCalledWith(null)
    expect(lastState().artReady).toBe(false)
    unmount()

    const fp = new ArrayBuffer(8)
    const ready = fakeEngine()
    await renderWindow(ready, { scan: { fingerprints: vi.fn(async () => fp) } })
    await run()
    expect(ready.init).toHaveBeenCalledWith(fp)
    expect(lastState().artReady).toBe(true)
  })

  it('scans with the file on disk while the fingerprint refresh hangs', async () => {
    stubCamera()
    const fp = new ArrayBuffer(8)
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderWindow(engine, {
      scan: {
        fingerprints: vi.fn(async () => fp),
        refreshFingerprints: vi.fn(() => new Promise<never>(() => {})),
        printingsByCode: vi.fn(async () => [printing()])
      }
    })
    await run(1000)
    expect(engine.init).toHaveBeenCalledWith(fp)
    expect(engine.analyze).toHaveBeenCalled()
    expect(drafts()).toHaveLength(1)
  })

  it('gives the engine the new file when a refresh downloads one', async () => {
    stubCamera()
    const old = new ArrayBuffer(8)
    const fresh = new ArrayBuffer(16)
    let file: ArrayBuffer | null = old
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
    const engine = fakeEngine()
    await renderWindow(engine, {
      scan: { fingerprints: vi.fn(async () => file), refreshFingerprints }
    })
    await run(500)
    expect(engine.init.mock.calls).toEqual([[old]])
    finish()
    await run(500)
    expect(engine.init.mock.calls).toEqual([[old], [fresh]])
  })

  it('keeps the engine as it is when a refresh finds nothing new', async () => {
    stubCamera()
    const engine = fakeEngine()
    await renderWindow(engine, {
      scan: {
        fingerprints: vi.fn(async () => new ArrayBuffer(8)),
        refreshFingerprints: vi.fn(async () => ({ state: 'ready' as const, count: 2 }))
      }
    })
    await run(1000)
    expect(engine.init).toHaveBeenCalledTimes(1)
  })

  it('a picked set passes its image ids as candidates', async () => {
    stubCamera()
    const printingsForSet = vi.fn(async () => [
      printing({ imageIds: [46986414, 46986415] }),
      printing({ printingId: 103, cardId: 2, imageIds: [89631139] })
    ])
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderWindow(engine, {
      sets: { list: vi.fn(async () => [] as SetSummary[]) },
      scan: { printingsForSet }
    })
    await run(500)
    expect(engine.analyze.mock.calls[0][1]).toMatchObject({ candidates: null })

    settings({ set: { setName: 'Legend of Blue Eyes White Dragon', language: 'de' } })
    await run(500)
    expect(printingsForSet).toHaveBeenCalledWith('Legend of Blue Eyes White Dragon', 'de')
    expect(engine.analyze.mock.calls.at(-1)?.[1]).toMatchObject({
      candidates: [46986414, 46986415, 89631139]
    })
  })

  it("a set whose cards can't be read scans as any set and says so", async () => {
    stubCamera()
    const engine = fakeEngine()
    await renderWindow(
      engine,
      {
        scan: {
          printingsForSet: vi.fn(async () => {
            throw new Error('db gone')
          })
        }
      },
      { set: { setName: 'Metal Raiders', language: 'en' } }
    )
    await run(1000)
    expect(lastState().setUnreadable).toBe(true)
    expect(engine.analyze.mock.calls.at(-1)?.[1]).toMatchObject({ candidates: null })
  })

  it('re-inits the engine after a failed analysis', async () => {
    stubCamera()
    const engine = fakeEngine((n) => (n === 0 ? new Error('worker died') : NOTHING))
    const { unmount } = await renderWindow(engine)
    await run(2000)
    expect(engine.analyze.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(engine.init).toHaveBeenCalledTimes(2)
    unmount()
    expect(engine.dispose).toHaveBeenCalled()
  })

  it('stops after repeated failures, keeps stopped across a set change, and retryScan resumes', async () => {
    stubCamera()
    let failing = true
    const engine = fakeEngine(() => (failing ? new Error('worker died') : NOTHING))
    await renderWindow(engine)
    await run(30_000)
    expect(lastState().loop).toEqual({ kind: 'stopped' })
    const calls = engine.analyze.mock.calls.length
    expect(calls).toBe(5)
    await run(5000)
    expect(engine.analyze.mock.calls.length).toBe(calls)

    settings({ set: { setName: 'Metal Raiders', language: 'en' } })
    await run(500)
    expect(lastState().loop).toEqual({ kind: 'stopped' })

    failing = false
    const inits = engine.init.mock.calls.length
    act(() => bridge.emit({ kind: 'retryScan' }))
    await run(500)
    expect(engine.init.mock.calls.length).toBe(inits + 1)
    expect(engine.analyze.mock.calls.length).toBeGreaterThan(calls)
    expect(lastState().loop).toEqual({ kind: 'idle' })
  })

  it('pausing stops analysis, and clears the overlay', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderWindow(engine, { scan: { printingsByCode: vi.fn(async () => [printing()]) } })
    await run(1000)
    expect(engine.analyze).toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'Pull' })).toBeInTheDocument()
    settings({ paused: true })
    await run(FADE_MS)
    expect(screen.queryByRole('status', { name: 'Pull' })).not.toBeInTheDocument()
    const calls = engine.analyze.mock.calls.length
    await run(1000)
    expect(engine.analyze.mock.calls.length).toBe(calls)
  })

  it('keeps scanning while the window is hidden', async () => {
    stubCamera()
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    try {
      const engine = fakeEngine()
      await renderWindow(engine)
      await run(500)
      expect(engine.analyze).toHaveBeenCalled()
    } finally {
      delete (document as { hidden?: boolean }).hidden
    }
  })

  it('denied camera shows only the message and reports it', async () => {
    stubCamera('NotAllowedError')
    await renderWindow(fakeEngine())
    await run()
    expect(screen.getByText('Camera not available')).toBeInTheDocument()
    expect(lastState().cameraError).toBe('denied')
  })

  it('no camera shows the message and reports no devices', async () => {
    stubCamera('NotFoundError')
    await renderWindow(fakeEngine())
    await run()
    expect(screen.getByText('Camera not available')).toBeInTheDocument()
    expect(lastState()).toMatchObject({ cameraError: 'none', devices: [] })
  })

  it('camera lost shows the message, and retryCamera brings the preview back', async () => {
    const { track, getUserMedia } = stubCamera()
    const engine = fakeEngine()
    await renderWindow(engine)
    await run(500)
    expect(engine.analyze).toHaveBeenCalled()
    expect(lastState()).toMatchObject({
      devices: [{ deviceId: 'cam1', label: 'Desk webcam' }],
      openDeviceId: 'cam1',
      cameraError: null
    })
    act(() => track.end())
    await run()
    expect(screen.getByText('Camera not available')).toBeInTheDocument()
    expect(lastState().cameraError).toBe('lost')
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    act(() => bridge.emit({ kind: 'retryCamera' }))
    await run()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Camera not available')).not.toBeInTheDocument()
    expect(lastState().cameraError).toBeNull()
  })

  it('a counted pull shows the bar, then fades out', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    // When the pull is pushed: the draft is sent in the same step.
    let pushedAt = 0
    bridge.scanWindow.send.mockImplementation((m) => {
      bridge.sent.push(m)
      if (m.kind === 'draft') pushedAt = Date.now()
    })
    await renderWindow(engine, {
      scan: { printingsByCode: vi.fn(async () => [printing({ price: 12.5 })]) }
    })
    while (pushedAt === 0) await run(50)
    const bar = screen.getByRole('status', { name: 'Pull' })
    expect(bar).toHaveTextContent('Dark Magician')
    expect(bar).toHaveTextContent('LOB-EN005')
    expect(bar).toHaveTextContent('Ultra Rare')
    expect(bar).toHaveTextContent('$12.50')
    expect(screen.queryByLabelText('Hit')).not.toBeInTheDocument()
    const fading = (): HTMLElement => screen.getByRole('status', { name: 'Pull' }).parentElement!

    await run(pushedAt + NORMAL_MS - 1 - Date.now())
    expect(fading()).toHaveClass('opacity-100')
    // The pull ends after NORMAL_MS, but its bar stays mounted while it fades.
    await run(1)
    expect(fading()).toHaveClass('opacity-0')
    await run(FADE_MS - 1)
    expect(fading()).toHaveClass('opacity-0')
    await run(1)
    expect(screen.queryByRole('status', { name: 'Pull' })).not.toBeInTheDocument()
  })

  it('a hit price changed in settings applies to the next pull', async () => {
    stubCamera()
    let card = true
    const engine = fakeEngine(() => (card ? codeFrame('LOB-EN005') : NOTHING))
    await renderWindow(engine, {
      scan: { printingsByCode: vi.fn(async () => [printing({ price: 12.5 })]) }
    })
    await run(1000)
    expect(drafts()).toHaveLength(1)
    expect(screen.queryByLabelText('Hit')).not.toBeInTheDocument()
    card = false
    await run(1500)
    settings({ hitPrice: 10 })
    card = true
    await run(1000)
    expect(drafts()).toHaveLength(2)
    expect(screen.getByLabelText('Hit')).toHaveTextContent('$12.50')
  })

  it('sends its state again with every settings message', async () => {
    stubCamera()
    await renderWindow(fakeEngine())
    await run(500)
    const states = (): number => bridge.sent.filter((m) => m.kind === 'state').length
    const before = states()
    expect(before).toBeGreaterThan(0)
    settings({})
    await run()
    expect(states()).toBe(before + 1)
    expect(lastState()).toMatchObject({ openDeviceId: 'cam1', cameraError: null })
  })

  it('stops listening for messages when it unmounts', async () => {
    stubCamera()
    const { unmount } = await renderWindow(fakeEngine())
    expect(bridge.listening()).toBeGreaterThan(0)
    unmount()
    expect(bridge.listening()).toBe(0)
  })

  it('a pull at the hit price gets the hit moment', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderWindow(engine, {
      scan: { printingsByCode: vi.fn(async () => [printing({ price: 20 })]) }
    })
    await run(1000)
    const hit = screen.getByLabelText('Hit')
    expect(hit).toHaveTextContent('Dark Magician')
    expect(hit).toHaveTextContent('Ultra Rare')
    expect(hit).toHaveTextContent('$20.00')
    expect(screen.queryByRole('status', { name: 'Pull' })).not.toBeInTheDocument()
  })

  it('a Pick printing pull shows only the name', async () => {
    stubCamera()
    const engine = fakeEngine(() => ({
      ...NOTHING,
      found: true,
      quad,
      art: [{ imageId: 46986414, distance: 5 }]
    }))
    await renderWindow(engine, {
      scan: {
        cardsForImages: vi.fn(async () => [{ imageId: 46986414, cardId: 1 }]),
        printingsForCards: vi.fn(async () => [
          printing({ price: 50 }),
          printing({ printingId: 102, setCode: 'SDY-006', rarity: 'Common', price: 50 })
        ])
      }
    })
    await run(1000)
    expect(drafts()[0]).toMatchObject({ flag: 'pick-printing' })
    const bar = screen.getByRole('status', { name: 'Pull' })
    expect(bar).toHaveTextContent('Dark Magician')
    expect(bar).not.toHaveTextContent('LOB-EN005')
    expect(bar).not.toHaveTextContent('Rare')
    expect(bar).not.toHaveTextContent('$')
    expect(screen.queryByLabelText('Hit')).not.toBeInTheDocument()
  })

  it('shows no app UI', async () => {
    stubCamera()
    await renderWindow(fakeEngine())
    await run(500)
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryByText('Hold a card up')).not.toBeInTheDocument()
    expect(screen.queryByText(/./)).not.toBeInTheDocument()
  })
})
