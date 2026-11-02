import { act, screen, waitFor, within } from '@testing-library/react'
import type { SetSummary } from '@shared/types'
import type { ScanDraft } from '@shared/scan/types'
import type { TiltModel } from '@shared/scan/tilt'
import type { TiltReading } from '@shared/scan/tiltFeatures'
import type { ScanWindowSettings, ScanWindowState } from '@shared/scanWindow'
import type { RawSignals } from '@/features/scan/engine'
import { ScanWindowApp } from '@/features/scan/window/ScanWindowApp'
import { FADE_MS, NORMAL_MS, type Pull } from '@/features/scan/window/overlay'
import { PullOverlay } from '@/features/scan/window/PullOverlay'
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
  tiltEngine,
  type FakeEngine
} from './scanFakes'

const SETTINGS: ScanWindowSettings = {
  deviceId: null,
  paused: false,
  set: null,
  scanLanguage: 'en',
  defaultRarity: null,
  hitPrice: 20,
  fit: 'fill',
  zoom: 1
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

/** Each pull sent, once: a pull not yet acknowledged is sent again. */
const drafts = (): ScanDraft[] => [
  ...new Map(
    bridge.sent.flatMap((m) => (m.kind === 'draft' ? [[m.id, m.draft] as const] : []))
  ).values()
]
/** How many times anything was sent for a pull, by id. */
const sends = (): Map<string, number> => {
  const n = new Map<string, number>()
  for (const m of bridge.sent) if (m.kind === 'draft') n.set(m.id, (n.get(m.id) ?? 0) + 1)
  return n
}

const lastState = (): ScanWindowState => {
  const states = bridge.sent.flatMap((m) => (m.kind === 'state' ? [m.state] : []))
  return states[states.length - 1]
}

/** The state as the window has it now, before an effect has sent it. */
const lastStateSoon = (): ScanWindowState['loop'] => lastState().loop

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

  it('a photo counts what one look names, and live frames leave that card be', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    const live = engine.analyze.getMockImplementation() as (...a: unknown[]) => Promise<RawSignals>
    // Live frames can't name it; a photo can, with its text whatever the frame before asked.
    engine.analyze.mockImplementation(async (img: ImageData, opts: { photo?: boolean }) =>
      opts.photo ? live(img, opts) : NOTHING
    )
    await renderWindow(engine, { scan: { printingsByCode: vi.fn(async () => [printing()]) } })
    await run(500)
    act(() => bridge.emit({ kind: 'takePhoto' }))
    expect(lastStateSoon()).toEqual({ kind: 'reading' })
    await run(500)
    expect(engine.analyze.mock.calls.some(([, o]) => o.photo && o.wantText)).toBe(true)
    expect(drafts()).toHaveLength(1)
    expect(lastState().loop).toMatchObject({ kind: 'added', name: 'Dark Magician' })
  })

  it('a photo that names nothing says so, on every frame it tried', async () => {
    stubCamera()
    const engine = fakeEngine(() => NOTHING)
    await renderWindow(engine)
    await run(500)
    engine.analyze.mockClear()
    act(() => bridge.emit({ kind: 'takePhoto' }))
    await run(1000)
    expect(engine.analyze.mock.calls.filter(([, o]) => o.photo)).toHaveLength(3)
    expect(drafts()).toHaveLength(0)
    expect(lastState().loop).toEqual({ kind: 'photo-failed' })
  })

  it("searches only the chosen language's art on Pokémon", async () => {
    stubCamera()
    const engine = fakeEngine()
    const imagesForLanguage = vi.fn(async () => [1, 2])
    await renderWindow(
      engine,
      {
        games: { active: vi.fn(async () => 'pkm' as const) },
        scan: { imagesForLanguage }
      },
      { scanLanguage: 'ja' }
    )
    await run(500)
    expect(imagesForLanguage).toHaveBeenCalledWith('ja')
    expect(engine.scope).toHaveBeenCalledWith([1, 2])
  })

  it('resends a pull until the main window acknowledges it', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderWindow(engine, { scan: { printingsByCode: vi.fn(async () => [printing()]) } })
    await run(1000)
    const [id] = [...sends().keys()]
    expect(sends().get(id)).toBe(1)
    await run(2000)
    expect(sends().get(id)).toBe(2)
    act(() => bridge.emit({ kind: 'ack', id, scanned: 1 }))
    await run(4000)
    expect(sends().get(id)).toBe(2)
    expect(drafts()).toHaveLength(1)
  })

  it('a pull left unacknowledged when the window closed goes once the hub is listening', async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    const { unmount } = await renderWindow(engine, {
      scan: { printingsByCode: vi.fn(async () => [printing()]) }
    })
    await run(1000)
    const [id] = [...sends().keys()]
    unmount()

    bridge = fakeBridge()
    stubCamera()
    await renderWindow(
      fakeEngine(() => NOTHING),
      {},
      null
    )
    expect(sends().size).toBe(0)
    act(() => bridge.emit({ kind: 'settings', settings: SETTINGS }))
    expect(sends().get(id)).toBe(1)
    expect(drafts()[0]).toMatchObject({ name: 'Dark Magician' })
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

  it('scans the centre crop and draws no outline on the video', async () => {
    stubCamera()
    const engine = fakeEngine(() => ({ ...NOTHING, found: true, quad }))
    const { container } = await renderWindow(engine)
    await run(500)
    // The stubbed camera is 640x480: the centre 360x480 is scanned.
    expect(grabbed).toHaveBeenLastCalledWith(expect.any(HTMLVideoElement), 140, 0, 360, 480)
    const frame = engine.analyze.mock.calls[0][0] as ImageBitmap
    expect([frame.width, frame.height]).toEqual([360, 480])
    // Scanning is silent on stream: the card the loop found gets no outline.
    expect(container.querySelector('svg, polygon')).toBeNull()
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
    expect(engine.init).toHaveBeenCalledWith(null, [])
    expect(lastState().artReady).toBe(false)
    unmount()

    const fp = new ArrayBuffer(8)
    const ready = fakeEngine()
    await renderWindow(ready, { scan: { fingerprints: vi.fn(async () => fp) } })
    await run()
    expect(ready.init).toHaveBeenCalledWith(fp, [])
    expect(lastState().artReady).toBe(true)
  })

  it("gives the engine the file's reference scans, and none when they can't be had", async () => {
    stubCamera()
    const fp = new ArrayBuffer(8)
    const refs = [{ h: 'ab'.repeat(32), imageId: 7, printingIds: [33] }]
    const engine = fakeEngine()
    const { unmount } = await renderWindow(engine, {
      scan: { fingerprints: vi.fn(async () => fp), fingerprintRefs: vi.fn(async () => refs) }
    })
    await run()
    expect(engine.init).toHaveBeenCalledWith(fp, refs)
    unmount()

    const failing = fakeEngine()
    await renderWindow(failing, {
      scan: {
        fingerprints: vi.fn(async () => fp),
        fingerprintRefs: vi.fn(async () => Promise.reject(new Error('no')))
      }
    })
    await run()
    expect(failing.init).toHaveBeenCalledWith(fp, [])
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
    expect(engine.init).toHaveBeenCalledWith(fp, [])
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
    expect(engine.init.mock.calls).toEqual([[old, []]])
    finish()
    await run(500)
    expect(engine.init.mock.calls).toEqual([
      [old, []],
      [fresh, []]
    ])
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

  it('refetches set printings when data changes', async () => {
    stubCamera()
    const printingsForSet = vi.fn(async () => [printing()])
    let onDataChanged: () => void = () => {}
    await renderWindow(
      fakeEngine(),
      {
        scan: { printingsForSet },
        app: {
          onDataChanged: vi.fn((cb: () => void) => {
            onDataChanged = cb
            return () => {}
          })
        }
      },
      { set: { setName: 'Legend of Blue Eyes White Dragon', language: 'en' } }
    )
    await run(500)
    expect(printingsForSet).toHaveBeenCalledTimes(1)

    act(() => onDataChanged())
    await run(500)
    expect(printingsForSet).toHaveBeenCalledTimes(2)
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

  it("the summary screen comes and goes on the main window's word, and scanning carries on", async () => {
    stubCamera()
    await renderWindow(fakeEngine())
    const summary = { value: 12.5, cards: 1, hits: 0, unpriced: 0, hit: null, list: [] }
    act(() => bridge.emit({ kind: 'summary', summary }))
    expect(screen.getByRole('status', { name: 'Summary' })).toHaveTextContent('$12.50')
    expect(document.querySelector('video')).toBeInTheDocument()
    act(() => bridge.emit({ kind: 'summary', summary: null }))
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Summary' })).not.toBeInTheDocument()
    )
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
    expect(bar).toHaveTextContent('LOB-EN005 · Legend of Blue Eyes White Dragon')
    expect(bar).toHaveTextContent('Ultra Rare')
    expect(bar).toHaveTextContent('$12.50')
    expect(screen.queryByLabelText('Hit')).not.toBeInTheDocument()
    // The phone's "found it" glow, with its bubble on a card.
    const burst = document.querySelector('[data-found-burst]')!
    expect(burst).toHaveTextContent('Dark Magician')
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

  it("a counted pull says it's a new card once the main window acknowledges it", async () => {
    stubCamera()
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    await renderWindow(engine, {
      scan: { printingsByCode: vi.fn(async () => [printing({ price: 12.5 })]) }
    })
    let draft = bridge.sent.find((m) => m.kind === 'draft')
    while (!draft) {
      await run(50)
      draft = bridge.sent.find((m) => m.kind === 'draft')
    }
    const bar = screen.getByRole('status', { name: 'Pull' })
    await run(0)
    expect(bar).not.toHaveTextContent('New card')
    act(() => bridge.emit({ kind: 'ack', id: draft.id, scanned: 1 }))
    await run(0)
    expect(bar).toHaveTextContent('New card')
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
    // A hit glows too, without the bubble: its banner already names it.
    const burst = document.querySelector('[data-found-burst]')!
    expect(burst).toBeInTheDocument()
    expect(burst).not.toHaveTextContent('Dark Magician')
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
    expect(screen.getByTestId('confetti')).toBeInTheDocument()
    expect(hit).toHaveTextContent('Ultra Rare')
    expect(hit).toHaveTextContent('$20.00')
    expect(screen.queryByRole('status', { name: 'Pull' })).not.toBeInTheDocument()
  })

  it('a Pick printing pull shows the name, its assumed price and the range under it, never a hit', async () => {
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
          printing({ printingId: 102, setCode: 'SDY-006', rarity: 'Common', price: 2 })
        ])
      }
    })
    await run(1000)
    expect(drafts()[0]).toMatchObject({ flag: 'pick-printing' })
    const bar = screen.getByRole('status', { name: 'Pull' })
    expect(bar).toHaveTextContent('Dark Magician')
    expect(bar).not.toHaveTextContent('LOB-EN005')
    expect(bar).not.toHaveTextContent('Rare')
    expect(within(bar).getByText('$2.00')).toBeInTheDocument()
    expect(within(bar).getByText('$2.00 – $50.00')).toBeInTheDocument()
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

  describe('picture', () => {
    it('fills the window by default, or shows the whole picture, zoomed on its centre', async () => {
      stubCamera()
      await renderWindow(fakeEngine(() => NOTHING))
      const video = document.querySelector('video')!
      expect(video).toHaveClass('object-cover')
      expect(video.style.transform).toBe('')

      settings({ fit: 'whole', zoom: 2 })
      await run()
      expect(video).toHaveClass('object-contain')
      expect(video.style.transform).toBe('scale(2)')
    })
  })
})

describe('Scan window tilt', () => {
  // One feature: below 0 reads as Common, above it as Ultra Rare.
  const MODEL: TiltModel = {
    features: ['f'],
    classes: ['Common', 'Ultra Rare'],
    pairs: [{ a: 'Common', b: 'Ultra Rare', use: [0], mean: [0], spread: [1], ca: [-1], cb: [1] }]
  }
  const FEW: TiltReading = { features: [1], frames: 4, motion: 50 }
  const FOILS = [
    printing({ rarity: 'Common' }),
    printing({ printingId: 102, rarity: 'Ultra Rare' })
  ]
  const held = (code = 'LOB-EN005', imageId = 46986414): RawSignals => ({
    ...codeFrame(code),
    art: [{ imageId, distance: 10 }]
  })
  it('a card with unsure Common/Ultra Rare options counts on its first recognized frame', async () => {
    stubCamera()
    const engine = tiltEngine(
      () => held(),
      () => FEW
    )
    renderWithProviders(
      <ScanWindowApp engineFactory={() => engine} tiltModels={{ ygo: MODEL }} />,
      {
        api: createMockApi({
          scanWindow: bridge.scanWindow,
          scan: {
            printingsByCode: vi.fn(async (code: string) => (code === 'LOB-EN005' ? FOILS : []))
          }
        })
      }
    )
    act(() => bridge.emit({ kind: 'settings', settings: SETTINGS }))
    await run()
    await run(1000)
    expect(drafts()).toEqual([expect.objectContaining({ name: 'Dark Magician' })])
    expect(lastState().loop).toMatchObject({ kind: 'added', name: 'Dark Magician' })
    expect(screen.queryByText(/Tilt the card/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
  })
})

describe('Scan window rarity reads', () => {
  const MODEL: TiltModel = {
    features: ['f'],
    classes: ['Common', 'Ultra Rare'],
    pairs: [{ a: 'Common', b: 'Ultra Rare', use: [0], mean: [0], spread: [1], ca: [-1], cb: [1] }]
  }
  const USABLE: TiltReading = { features: [1], frames: 10, motion: 50 }
  const FOILS = [
    printing({ rarity: 'Common' }),
    printing({ printingId: 102, rarity: 'Ultra Rare' })
  ]
  const held = (): RawSignals => ({
    ...codeFrame('LOB-EN005'),
    art: [{ imageId: 46986414, distance: 10 }]
  })
  const rarities = (): { id: string; draft: ScanDraft }[] =>
    bridge.sent.flatMap((m) => (m.kind === 'rarity' ? [{ id: m.id, draft: m.draft }] : []))

  async function start(): Promise<string> {
    stubCamera()
    const engine = tiltEngine(
      () => held(),
      () => USABLE
    )
    renderWithProviders(
      <ScanWindowApp engineFactory={() => engine} tiltModels={{ ygo: MODEL }} />,
      {
        api: createMockApi({
          scanWindow: bridge.scanWindow,
          scan: { printingsByCode: vi.fn(async () => FOILS) }
        })
      }
    )
    act(() => bridge.emit({ kind: 'settings', settings: SETTINGS }))
    await run()
    await run(1000)
    return [...sends().keys()][0]
  }

  it('sends no rarity for a pull the main window has not acknowledged', async () => {
    const id = await start()
    await run(10000)
    expect(id).toBeTruthy()
    expect(rarities()).toEqual([])
  })

  it('once acknowledged, resends the read every 2 s until rarityAck, then stops', async () => {
    const id = await start()
    act(() => bridge.emit({ kind: 'ack', id, scanned: 1 }))
    await run(10000)
    const n = rarities().length
    expect(n).toBeGreaterThanOrEqual(2)
    expect(rarities()[0]).toMatchObject({ id, draft: { rarity: 'Ultra Rare' } })
    act(() => bridge.emit({ kind: 'rarityAck', id }))
    await run(10000)
    expect(rarities()).toHaveLength(n)
  })

  it('ignores a rarityAck for an id it does not hold', async () => {
    const id = await start()
    act(() => bridge.emit({ kind: 'rarityAck', id: 'nope' }))
    act(() => bridge.emit({ kind: 'ack', id, scanned: 1 }))
    await run(4000)
    expect(rarities().length).toBeGreaterThan(0)
  })
})

describe('Scan window and the game', () => {
  it('scans the active game, and re-inits when the game changes', async () => {
    stubCamera()
    let active: 'ygo' | 'pkm' = 'pkm'
    const changed: (() => void)[] = []
    const factory = vi.fn(() => fakeEngine())
    const api = createMockApi({
      scanWindow: bridge.scanWindow,
      games: {
        available: vi.fn(async () => ['ygo', 'pkm'] as never),
        active: vi.fn(async () => active)
      },
      app: {
        onDataChanged: vi.fn((cb: () => void) => {
          changed.push(cb)
          return () => {}
        })
      }
    })
    renderWithProviders(<ScanWindowApp engineFactory={factory} />, { api })
    act(() => bridge.emit({ kind: 'settings', settings: SETTINGS }))
    await run()
    await run(500)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenLastCalledWith('pkm')
    expect(api.scan.fingerprints).toHaveBeenLastCalledWith('pkm')

    // Switched in the main window: main tells every window the data changed.
    active = 'ygo'
    await act(async () => {
      for (const cb of changed) cb()
    })
    await run(500)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(factory).toHaveBeenLastCalledWith('ygo')
    expect(api.scan.fingerprints).toHaveBeenLastCalledWith('ygo')
  })
})

describe('PullOverlay for Pokémon pulls', () => {
  const pull = (o: Partial<Pull> = {}): Pull => ({
    key: 1,
    id: 'p',
    cardId: 9,
    printingId: 90,
    name: 'Pikachu',
    imageId: 500,
    setCode: null,
    setName: null,
    rarity: null,
    price: null,
    range: null,
    raw: false,
    hit: false,
    ...o
  })

  const owning = (quantity: number): { api: Api } => {
    const api = createMockApi()
    vi.mocked(api.collection.forCard).mockResolvedValue(
      (quantity ? [{ quantity, printing: { id: 90 } }] : []) as never
    )
    return { api }
  }

  it('shows nothing about owning a pull until the main window has counted it', async () => {
    const { api, rerender } = renderWithProviders(<PullOverlay pull={pull()} />, owning(0))
    await waitFor(() => expect(api.collection.forCard).toHaveBeenCalledWith(9))
    await act(async () => {})
    expect(screen.queryByText('New card')).not.toBeInTheDocument()
    rerender(<PullOverlay pull={pull()} scanned={{ p: 1 }} />)
    expect(await screen.findByText('New card')).toBeInTheDocument()
  })

  it('says how many a pull has, on the bar and on the hit moment', async () => {
    const { rerender } = renderWithProviders(
      <PullOverlay pull={pull()} scanned={{ p: 2 }} />,
      owning(3)
    )
    expect(await screen.findByText('Own 3 · ×2 this scan')).toBeInTheDocument()
    rerender(<PullOverlay pull={pull({ key: 2, price: 50, hit: true })} scanned={{ p: 2 }} />)
    expect(
      await within(screen.getByLabelText('Hit')).findByText('Own 3 · ×2 this scan')
    ).toBeInTheDocument()
  })

  it('pkm pick-printing pull shows range and is never a hit', () => {
    renderWithProviders(<PullOverlay pull={pull({ range: { low: 2, high: 45 } })} />, {
      api: createMockApi()
    })
    const bar = screen.getByRole('status', { name: 'Pull' })
    expect(bar).toHaveTextContent('$2.00 – $45.00')
    // No lone price beside the range.
    expect(bar.textContent?.match(/\$/g)).toHaveLength(2)
    expect(screen.queryByLabelText('Hit')).not.toBeInTheDocument()
  })

  it('slab pull shows Raw and can be a hit', () => {
    const { rerender } = renderWithProviders(
      <PullOverlay pull={pull({ price: 120, raw: true, hit: true })} />,
      { api: createMockApi() }
    )
    expect(screen.getByLabelText('Hit')).toHaveTextContent('$120.00')
    expect(screen.getByLabelText('Hit')).toHaveTextContent('Raw')
    rerender(<PullOverlay pull={pull({ key: 2, price: 5, raw: true })} />)
    expect(screen.getByRole('status', { name: 'Pull' })).toHaveTextContent('Raw')
    rerender(<PullOverlay pull={pull({ key: 3, price: 5 })} />)
    expect(screen.getByRole('status', { name: 'Pull' })).not.toHaveTextContent('Raw')
  })

  it('lays the bar out for a phone stream, leaving the desktop bar as it was', () => {
    const { rerender } = renderWithProviders(<PullOverlay pull={pull()} />)
    const desktop = screen.getByLabelText('Pull').className
    expect(desktop).toContain('left-[3vw]')
    expect(desktop).not.toContain('safe-area')
    rerender(<PullOverlay pull={pull()} phone />)
    const bar = screen.getByLabelText('Pull').className
    expect(bar).toContain('inset-x-3')
    expect(bar).toContain('env(safe-area-inset-bottom)')
    expect(bar).toContain('landscape:max-w-[55vw]')
    expect(bar).not.toContain('left-[3vw]')
  })

  it('puts the found bubble below the safe area on a phone, and leaves the desktop one', () => {
    const bubbleBox = (container: HTMLElement): string =>
      container.querySelector('[data-found-burst] > .inset-x-0.flex')!.className
    const { container, rerender } = renderWithProviders(<PullOverlay pull={pull()} />)
    const desktop = bubbleBox(container)
    expect(desktop).toContain('top-[4vw]')
    expect(desktop).not.toContain('safe-area')
    rerender(<PullOverlay pull={pull()} phone />)
    const phone = bubbleBox(container)
    expect(phone).toContain('top-[calc(env(safe-area-inset-top)+3.5rem)]')
    expect(phone).toContain('landscape:pl-[max(4vw,env(safe-area-inset-left))]')
    expect(phone).toContain('landscape:pr-[max(4vw,env(safe-area-inset-right))]')
    expect(phone).not.toContain('top-[4vw]')
  })

  it('keeps the phone hit moment under the clock', () => {
    renderWithProviders(<PullOverlay pull={pull({ hit: true, price: 90 })} phone />)
    expect(screen.getByLabelText('Hit').className).toContain('env(safe-area-inset-top)')
  })
})
