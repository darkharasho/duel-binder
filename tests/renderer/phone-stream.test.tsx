import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import * as hubScan from '@/features/scan/useHubScan'
import { TILT_MODELS } from '@shared/scan/tiltModel'
import type { ScanRow } from '@/features/scan/session'
import { PhoneContext } from '../../src/phone/context'
import { ScannerScreen } from '../../src/phone/ScannerScreen'
import { StreamScreen } from '../../src/phone/stream/StreamScreen'
import { handleBack } from '../../src/phone/backButton'
import { enterStream, exitStream, reacquireStream } from '../../src/phone/stream/device'
import { scanArea } from '../../src/phone/stream/scanArea'
import type { StreamRecord } from '../../src/phone/stream/record'
import { createMockApi, renderWithProviders } from './mockApi'
import { SETO, fakeStore } from './phoneFakes'
import {
  NOTHING,
  codeFrame,
  fakeBridge,
  fakeEngine,
  printing,
  stubCamera,
  stubVideo
} from './scanFakes'

vi.mock('../../src/phone/stream/device', () => ({
  enterStream: vi.fn(async () => ({ awake: true })),
  reacquireStream: vi.fn(async () => {}),
  exitStream: vi.fn(async () => {})
}))

const SESSION_KEY = 'scan.session.v1'
const STREAM_KEY = 'scan.stream.v1'

const row = (o: Partial<ScanRow> = {}): ScanRow => ({
  key: '101:46986414#a',
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
let engine: ReturnType<typeof fakeEngine>

beforeEach(() => {
  localStorage.clear()
  stubVideo()
  camera = stubCamera()
  vi.mocked(enterStream).mockClear().mockResolvedValue({ awake: true })
  vi.mocked(reacquireStream).mockClear()
  vi.mocked(exitStream).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

const settle = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

/** Fake timers that Testing Library's waits and userEvent advance too. */
function fakeTime(): ReturnType<typeof userEvent.setup> {
  vi.useFakeTimers()
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

/** An api whose scans of LOB-EN005 find Dark Magician at `price`. */
function scanApi(price: number | null = null): ReturnType<typeof createMockApi> {
  return createMockApi({
    scan: { printingsByCode: vi.fn(async () => [printing({ price })]) },
    scanWindow: fakeBridge().scanWindow
  })
}

/** The stream screen, with an engine that sees `frame` (nothing at all by default). */
function renderStream(
  api = scanApi(),
  frame?: Parameters<typeof fakeEngine>[0]
): ReturnType<typeof renderWithProviders> & { onExit: ReturnType<typeof vi.fn> } {
  engine = fakeEngine(frame)
  const onExit = vi.fn()
  const view = renderWithProviders(
    <ScanHubProvider>
      <StreamScreen engineFactory={() => engine} onExit={onExit} />
    </ScanHubProvider>,
    { api }
  )
  return { ...view, onExit }
}

/** Renders the stream screen and starts a stream, with LOB-EN005 held up to the camera. */
async function goLive(
  user: ReturnType<typeof userEvent.setup>,
  price: number | null = null
): Promise<ReturnType<typeof renderStream>> {
  const view = renderStream(scanApi(price), () => codeFrame('LOB-EN005'))
  await settle()
  await user.click(screen.getByRole('button', { name: 'Start' }))
  await settle()
  return view
}

const savedRecord = (rows: ScanRow[]): StreamRecord => ({ game: 'ygo', rows, saved: {} })

describe('phone stream camera', () => {
  it('reads rarity from the tilt with the shipped models', async () => {
    fakeTime()
    const spy = vi.spyOn(hubScan, 'useHubScan')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderStream()
    await settle()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await settle()
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tiltModels: TILT_MODELS }))
    spy.mockRestore()
  })
})

describe('phone stream start screen', () => {
  it("opens from the scanner's Stream button", async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    renderWithProviders(
      <PhoneContext.Provider value={{ store, user: SETO, signedOut: () => {} }}>
        <ScanHubProvider>
          <ScannerScreen
            engineFactory={() => fakeEngine()}
            onClose={() => {}}
            onOpenSettings={() => {}}
          />
        </ScanHubProvider>
      </PhoneContext.Provider>,
      { api: scanApi() }
    )
    await user.click(await screen.findByRole('button', { name: 'Stream' }))
    expect(screen.getByLabelText('Hit price')).toHaveValue(20)
    expect(
      screen.getByText('Turn on Do Not Disturb, because viewers can see notifications.')
    ).toBeInTheDocument()
    expect(screen.getByText('Start your Discord share first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    // The scanner's camera is gone, so only one camera is ever open.
    expect(screen.queryByRole('region', { name: 'Camera' })).not.toBeInTheDocument()
  })

  it('changing the hit price saves it', async () => {
    const user = userEvent.setup()
    renderStream()
    const input = screen.getByLabelText('Hit price')
    await user.clear(input)
    await user.type(input, '50{Enter}')
    expect(localStorage.getItem('scan.hitPrice')).toBe('50')
  })

  it("says to set Auto-Lock when the screen can't be held on", async () => {
    vi.mocked(enterStream).mockResolvedValue({ awake: false })
    const user = userEvent.setup()
    renderStream()
    expect(screen.queryByText('Set Auto-Lock to Never so the screen stays on.')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(
      await screen.findByText('Set Auto-Lock to Never so the screen stays on.')
    ).toBeInTheDocument()
    // Starting again, having been told, goes live.
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('0 cards')).toBeInTheDocument()
  })

  it('takes the device once when Start is tapped twice before it answers', async () => {
    let held: (v: { awake: boolean }) => void = () => {}
    vi.mocked(enterStream).mockReturnValue(new Promise((r) => (held = r)))
    const user = userEvent.setup()
    renderStream()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await act(async () => held({ awake: true }))
    expect(enterStream).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('0 cards')).toBeInTheDocument()
  })

  it('offers to carry on a saved stream', async () => {
    const rows = [row(), row({ key: '101:46986414#b', quantity: 2 })]
    localStorage.setItem(SESSION_KEY, JSON.stringify(rows))
    localStorage.setItem(STREAM_KEY, JSON.stringify(savedRecord(rows)))
    const user = userEvent.setup()
    const first = renderStream()
    expect(await screen.findByRole('button', { name: 'Carry on (3 cards)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Carry on (3 cards)' }))
    expect(await screen.findByText('3 cards')).toBeInTheDocument()
    first.unmount()

    renderStream()
    await user.click(await screen.findByRole('button', { name: 'Start new' }))
    expect(await screen.findByText('0 cards')).toBeInTheDocument()
    const record = JSON.parse(localStorage.getItem(STREAM_KEY)!) as StreamRecord
    expect(record.rows).toEqual([])
    // The list is left alone.
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual(rows)
  })

  it('Start new keeps the saved record until the new stream goes live', async () => {
    vi.mocked(enterStream).mockResolvedValue({ awake: false })
    const rows = [row()]
    localStorage.setItem(SESSION_KEY, JSON.stringify(rows))
    const saved = JSON.stringify(savedRecord(rows))
    localStorage.setItem(STREAM_KEY, saved)
    const user = userEvent.setup()
    const { onExit } = renderStream()
    await user.click(await screen.findByRole('button', { name: 'Start new' }))
    expect(
      await screen.findByText('Set Auto-Lock to Never so the screen stays on.')
    ).toBeInTheDocument()
    expect(localStorage.getItem(STREAM_KEY)).toBe(saved)
    // Still offered, and leaving here keeps it.
    expect(screen.getByRole('button', { name: 'Carry on (1 card)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onExit).toHaveBeenCalled()
    expect(localStorage.getItem(STREAM_KEY)).toBe(saved)
  })

  it('the close button leaves without starting', async () => {
    const user = userEvent.setup()
    const { onExit } = renderStream()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onExit).toHaveBeenCalled()
    expect(enterStream).not.toHaveBeenCalled()
  })

  it("Android's back leaves the start screen", () => {
    const { onExit } = renderStream()
    act(() => void handleBack())
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})

describe('phone stream live screen', () => {
  it("Android's back never ends a running stream", async () => {
    const user = fakeTime()
    const { onExit } = await goLive(user, 4)
    act(() => void handleBack())
    expect(onExit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('shows a pull and counts it', async () => {
    const user = fakeTime()
    await goLive(user, 4)
    await settle(1500)
    const pull = screen.getByRole('status', { name: 'Pull' })
    expect(pull).toHaveTextContent('Dark Magician')
    expect(pull).toHaveTextContent('$4.00')
    expect(screen.getByText('1 card')).toBeInTheDocument()
    // Saved on every change, so a crash keeps it.
    const record = JSON.parse(localStorage.getItem(STREAM_KEY)!) as StreamRecord
    expect(record.rows.map((r) => r.name)).toEqual(['Dark Magician'])
  })

  it('does not show a Stream Add button', async () => {
    const user = fakeTime()
    await goLive(user)
    await settle(1500)
    expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument()
  })

  // Owner, after the spike: "it should have a popup at the bottom like the stream on desktop does."
  it('shows no scanner status bar', async () => {
    const user = fakeTime()
    const { container } = await goLive(user)
    expect(screen.queryByText('Hold a card up')).not.toBeInTheDocument()
    await settle(1500)
    expect(screen.queryByRole('button', { name: /Take photo/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Couldn't/)).not.toBeInTheDocument()
    expect(screen.queryByText(/lower it to scan the next card/)).not.toBeInTheDocument()
    // The result is the pop-up at the bottom, and nothing else says it.
    const pull = screen.getByRole('status', { name: 'Pull' })
    expect(pull).toHaveClass('absolute', 'bottom-[max(0.75rem,env(safe-area-inset-bottom))]')
    expect(screen.getAllByRole('status')).toEqual([pull])
    expect(container.querySelector('video')).toHaveClass('absolute', 'inset-0', 'object-cover')
  })

  // Owner, after the spike: "i also couldnt hit the top buttons on ios since it overlayed the time."
  it('keeps controls clear of the notch', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([row({ flag: 'check-rarity' })]))
    const user = fakeTime()
    await goLive(user)
    const safe = [
      'pt-[calc(env(safe-area-inset-top)+0.5rem)]',
      'pl-[calc(env(safe-area-inset-left)+0.75rem)]',
      'pr-[calc(env(safe-area-inset-right)+0.75rem)]'
    ]
    for (const el of [
      screen.getByText('0 cards'),
      screen.getByText('1 to check'),
      screen.getByRole('button', { name: 'Close stream' }),
      screen.getByRole('button', { name: 'Pause' })
    ]) {
      expect(el.closest('[data-safe-top]')).toHaveClass(...safe)
    }
  })

  // Owner, after the spike: "i didnt see any of the celebration for a hit."
  it('celebrates a hit', async () => {
    const user = fakeTime()
    await goLive(user, 50)
    await settle(1500)
    const hit = screen.getByRole('status', { name: 'Hit' })
    expect(hit).toHaveTextContent('Dark Magician')
    expect(hit).toHaveTextContent('$50.00')
    expect(screen.getByTestId('confetti')).toBeInTheDocument()
    // Viewers see only the celebration: the count and controls make way for it.
    expect(screen.queryByText('1 card')).not.toBeInTheDocument()
    await settle(6000)
    expect(screen.getByRole('status', { name: 'Hit' })).toBeInTheDocument()
    await settle(2500)
    // The fade out starts once the 8 s are up.
    await settle(300)
    expect(screen.queryByRole('status', { name: 'Hit' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('confetti')).not.toBeInTheDocument()
    expect(screen.getByText('1 card')).toBeInTheDocument()
  })

  it('shows the corner marks', async () => {
    const view = { width: 390, height: 844 }
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => view.width
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => view.height
    })
    // As a browser's does, it reports each element's size once it starts watching.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: () => void) {}
        observe = (): void => this.cb()
        disconnect = (): void => {}
      }
    )
    try {
      const user = fakeTime()
      const { container } = await goLive(user)
      fireEvent(container.querySelector('video')!, new Event('resize'))
      const want = scanArea({ width: 640, height: 480 }, view)
      expect(screen.getByTestId('scan-area')).toHaveStyle({
        left: `${want.x}px`,
        top: `${want.y}px`,
        width: `${want.width}px`,
        height: `${want.height}px`
      })
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    }
  })

  it('shows to-check only when there is some', async () => {
    // Older rows, from before the stream, count too: the drawer shows them.
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify([
        row({ flag: 'check-rarity' }),
        row({ key: 'b', flag: 'pick-printing' }),
        row({ key: 'c' })
      ])
    )
    const user = fakeTime()
    const first = await goLive(user)
    expect(screen.getByText('2 to check')).toBeInTheDocument()
    first.unmount()

    localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
    await goLive(user)
    expect(screen.queryByText(/to check/)).not.toBeInTheDocument()
  })

  it('a tap shows Close stream and Pause, and they fade after 3 s', async () => {
    const user = fakeTime()
    await goLive(user)
    // Shown on the way in, then gone.
    expect(screen.getByRole('button', { name: 'Close stream' })).toBeInTheDocument()
    await settle(3000)
    expect(screen.queryByRole('button', { name: 'Close stream' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('region', { name: 'Stream' }))
    expect(screen.getByRole('button', { name: 'Close stream' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await settle(2900)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await settle(200)
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })

  it('pausing stops counting and clears the overlay', async () => {
    const user = fakeTime()
    await goLive(user)
    await settle(1500)
    expect(screen.getByRole('status', { name: 'Pull' })).toBeInTheDocument()
    await user.click(screen.getByRole('region', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await settle(300)
    expect(screen.queryByRole('status', { name: 'Pull' })).not.toBeInTheDocument()
    const frames = engine.analyze.mock.calls.length
    await settle(3000)
    expect(engine.analyze.mock.calls.length).toBe(frames)
    // Paused, viewers see only the camera; the controls still say how to carry on.
    expect(screen.queryByText('1 card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scan-area')).not.toBeInTheDocument()
    await user.click(screen.getByRole('region', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByText('1 card')).toBeInTheDocument()
  })

  it('says when the camera stops', async () => {
    const user = fakeTime()
    await goLive(user)
    await settle(1500)
    act(() => camera.track.end())
    expect(screen.getByText('The camera stopped.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText('1 card')).toBeInTheDocument()
    const opens = camera.getUserMedia.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await settle()
    expect(camera.getUserMedia.mock.calls.length).toBe(opens + 1)
    expect(screen.queryByText('The camera stopped.')).not.toBeInTheDocument()
  })

  it('takes the wake lock again when the app returns', async () => {
    const user = fakeTime()
    const { unmount } = await goLive(user)
    expect(enterStream).toHaveBeenCalledTimes(1)
    expect(reacquireStream).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(reacquireStream).toHaveBeenCalledTimes(1)
    // Any way out puts the phone back.
    unmount()
    expect(exitStream).toHaveBeenCalled()
  })

  it('Close stream stops the stream without saving or clearing the list', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([row({ key: 'old' })]))
    const user = fakeTime()
    const { api } = await goLive(user)
    await settle(1500)
    await user.click(screen.getByRole('region', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: 'Close stream' }))
    await settle()
    expect(api.collection.add).not.toHaveBeenCalled()
    const list = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
    expect(list).toHaveLength(2)
    const frames = engine.analyze.mock.calls.length
    await settle(3000)
    expect(engine.analyze.mock.calls.length).toBe(frames)
  })
})

describe('phone stream review handle', () => {
  it('is hidden while a hit shows and comes back after', async () => {
    const user = fakeTime()
    await goLive(user, 50)
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
    await settle(1500)
    expect(screen.getByRole('status', { name: 'Hit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
    await settle(6000)
    await settle(2500)
    await settle(300)
    expect(screen.queryByRole('status', { name: 'Hit' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })
})

const three = (): ScanRow[] => [
  row({ key: '101:46986414#a', flag: 'check-rarity' }),
  row({ key: '101:46986414#b', name: 'Blue-Eyes White Dragon' }),
  row({ key: '101:46986414#c', name: 'Red-Eyes Black Dragon' })
]

/** A live stream over `rows` on the list, with nothing held to the camera until `see()`. */
async function liveOver(
  rows: ScanRow[],
  user: ReturnType<typeof userEvent.setup>
): Promise<ReturnType<typeof renderStream> & { see: () => void }> {
  localStorage.setItem(SESSION_KEY, JSON.stringify(rows))
  localStorage.setItem(STREAM_KEY, JSON.stringify(savedRecord(rows)))
  let seen = false
  const view = renderStream(scanApi(), () => (seen ? codeFrame('LOB-EN005') : NOTHING))
  await settle()
  await user.click(screen.getByRole('button', { name: /^Carry on/ }))
  await settle()
  return { ...view, see: () => (seen = true) }
}

const rowsIn = (): string[] =>
  within(screen.getByRole('list', { name: 'This session' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('p')!.textContent!)

describe('phone stream while paused', () => {
  it('shows only the camera: no review handle either', async () => {
    const user = fakeTime()
    await liveOver(three(), user)
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })
})

describe('phone stream review drawer', () => {
  it('the sideways drawer keeps clear of the notch', async () => {
    const user = fakeTime()
    await liveOver(three(), user)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    const drawer = screen.getByRole('region', { name: /Review/ }).className
    expect(drawer).toContain('landscape:pr-[max(0.75rem,env(safe-area-inset-right))]')
    expect(drawer).toContain('landscape:pt-[env(safe-area-inset-top)]')
    // Upright it sits at the bottom, so its bottom inset stays with the footer.
    expect(drawer).not.toMatch(/(^|\s)(pr|pt)-/)
  })

  it('taps inside the drawer do not bring back the stream controls', async () => {
    const user = fakeTime()
    await liveOver(three(), user)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await settle(3500)
    expect(screen.queryByRole('button', { name: 'Close stream' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'One more Dark Magician' }))
    expect(screen.queryByRole('button', { name: 'Close stream' })).not.toBeInTheDocument()
  })

  it('the drawer opens on cards to check', async () => {
    const user = fakeTime()
    await liveOver(three(), user)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(rowsIn()).toEqual(['Dark Magician'])
    expect(screen.getByRole('button', { name: 'To check' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(rowsIn()).toHaveLength(3)
  })

  it('the pill for cards to check opens it too', async () => {
    const user = fakeTime()
    await liveOver(three(), user)
    await user.click(screen.getByRole('button', { name: '1 to check' }))
    expect(screen.getByRole('button', { name: 'Close review' })).toBeInTheDocument()
  })

  it("the drawer's Add covers the whole list", async () => {
    const user = fakeTime()
    await liveOver(three(), user)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(rowsIn()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Add 3 cards' })).toBeEnabled()
  })

  it('the normal review is unchanged', async () => {
    const user = userEvent.setup()
    localStorage.setItem(SESSION_KEY, JSON.stringify(three()))
    const store = fakeStore()
    renderWithProviders(
      <PhoneContext.Provider value={{ store, user: SETO, signedOut: () => {} }}>
        <ScanHubProvider>
          <ScannerScreen
            engineFactory={() => fakeEngine()}
            onClose={() => {}}
            onOpenSettings={() => {}}
          />
        </ScanHubProvider>
      </PhoneContext.Provider>,
      { api: scanApi() }
    )
    await user.click(await screen.findByRole('button', { name: /Review/ }))
    expect(rowsIn()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'To check' })).not.toBeInTheDocument()
    expect(document.querySelector('.bg-black\\/40')).toBeInTheDocument()
  })

  it('scanning continues while the drawer is open', async () => {
    const user = fakeTime()
    const { see } = await liveOver(three(), user)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText('3 cards')).toBeInTheDocument()
    see()
    await settle(1500)
    expect(screen.getByText('4 cards')).toBeInTheDocument()
  })

  it('saving mid-stream keeps the count', async () => {
    const user = fakeTime()
    const { see } = await liveOver(three(), user)
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Add 3 cards' }))
    await settle()
    expect(screen.getByText('3 cards')).toBeInTheDocument()
    see()
    await settle(1500)
    expect(screen.getByText('4 cards')).toBeInTheDocument()
  })
})

describe('phone stream end', () => {
  it('Close stream shows the summary and stops counting', async () => {
    const user = fakeTime()
    const { see } = await liveOver(three(), user)
    await user.click(screen.getByRole('region', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: 'Close stream' }))
    see()
    await settle(1500)
    const summary = screen.getByRole('status', { name: 'Summary' })
    expect(within(summary).getByText('cards').parentElement).toHaveTextContent('3cards')
    expect(screen.queryByRole('status', { name: 'Pull' })).not.toBeInTheDocument()
  })

  it('the summary has Review and no Add', async () => {
    const user = fakeTime()
    await liveOver(three(), user)
    await user.click(screen.getByRole('region', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: 'Close stream' }))
    expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('button', { name: 'Close review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 3 cards' })).toBeInTheDocument()
  })

  it('the summary keeps clear of the notch and pages fewer rows than the desktop', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ key: `101:46986414#${i}`, name: `Card ${i}` })
    )
    const user = fakeTime()
    await liveOver(rows, user)
    await user.click(screen.getByRole('region', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: 'Close stream' }))
    const summary = screen.getByRole('status', { name: 'Summary' })
    expect(summary.className).toContain('pt-[calc(env(safe-area-inset-top)+4vh)]')
    expect(summary.className).toContain('pl-[max(4vw,env(safe-area-inset-left))]')
    expect(summary.className).toContain('pr-[max(4vw,env(safe-area-inset-right))]')
    // The test window is sideways, where fewer rows fit than the desktop's nine.
    expect(
      within(screen.getByRole('region', { name: 'Every card' })).getAllByRole('listitem')
    ).toHaveLength(7)
  })

  it("an empty stream's summary leaves cleanly", async () => {
    const user = fakeTime()
    const { onExit } = await goLive(user)
    await user.click(screen.getByRole('button', { name: 'Close stream' }))
    expect(screen.getByText('No cards yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onExit).toHaveBeenCalled()
  })

  it("the stream's end offers Make replay beside Review and Done", async () => {
    const user = fakeTime()
    await goLive(user)
    await user.click(screen.getByRole('button', { name: 'Close stream' }))
    const replay = screen.getByRole('button', { name: 'Make replay' })
    expect(replay.parentElement?.parentElement).toContainElement(
      screen.getByRole('button', { name: 'Done' })
    )
    // An empty stream has nothing to replay.
    expect(replay).toBeDisabled()
  })

  it('Done ends the record and keeps the list', async () => {
    const rows = three()
    const user = fakeTime()
    const { onExit } = await liveOver(rows, user)
    await user.click(screen.getByRole('region', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: 'Close stream' }))
    expect(localStorage.getItem(STREAM_KEY)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onExit).toHaveBeenCalled()
    expect(localStorage.getItem(STREAM_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual(rows)
  })
})
