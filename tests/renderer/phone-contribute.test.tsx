import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import { cardImageSrc } from '@/lib/images'
import type { CardDetail, Printing } from '@shared/types'
import type { ScanPrinting } from '@shared/scan/types'
import type { TrainingLabel } from '@shared/training'
import { PhoneContext } from '../../src/phone/context'
import type { PhoneStore } from '../../src/phone/data/store'
import { deviceModel } from '../../src/phone/training/capture'
import { ContributeScreen } from '../../src/phone/training/ContributeScreen'
import {
  DROPPED,
  GRAB_FAILED,
  NOT_SYNCED,
  NO_VERSIONS,
  OFFLINE_WAIT,
  SNAP_MANY,
  SNAP_NONE,
  CAP_REACHED,
  WHAT_TO_SHOOT
} from '../../src/phone/training/copy'
import {
  createOutbox,
  memoryOutboxStorage,
  type Outbox,
  type OutboxStorage
} from '../../src/phone/training/outbox'
import { renderWithProviders } from './mockApi'
import { SETO, fakeStore, installPhoneApi, setOnline } from './phoneFakes'
import type { SnapResult } from '../../src/phone/training/numberSnap'
import { NOTHING, fakeEngine, stubCamera, stubVideo, type FakeEngine } from './scanFakes'
import type { Mock } from 'vitest'
import type { EngineFactory } from '@/features/scan/engine'
import type { GameId } from '@shared/games'

const CARD_ID = 2 ** 39 + 5
const NOW = new Date('2026-11-04T12:00:00.000Z')
const JPEG = (): ArrayBuffer => new Uint8Array([0xff, 0xd8, 0xff]).buffer

const printing = (o: Partial<Printing>): Printing => ({
  id: 501,
  cardId: CARD_ID,
  setName: 'Romance Dawn',
  setCode: 'OP01-001',
  setRarity: 'L',
  setRarityCode: 'L',
  setPrice: null,
  missingFromApi: false,
  language: 'en',
  ...o
})

const BASE = printing({})
const PARALLEL = printing({ id: 502, setRarity: 'L (Alternate Art)', artImageId: 7002 })
/** The same card in another product: not this number's. */
const PROMO = printing({ id: 503, setCode: 'P-001', setName: 'Promotion Cards', setRarity: 'P' })
/** Another number in the catalog, for the next card held up. */
const NEXT = printing({ id: 504, setCode: 'OP01-002', setRarity: 'C' })

const DETAIL: CardDetail = {
  card: { id: CARD_ID, name: 'Roronoa Zoro' } as CardDetail['card'],
  printings: [BASE, PARALLEL, PROMO, NEXT],
  images: [{ imageId: 7001, cardId: CARD_ID, sortOrder: 0 }]
}

const scanPrinting = (p: Printing): ScanPrinting =>
  ({ printingId: p.id, cardId: p.cardId, setCode: p.setCode, imageIds: [7001] }) as ScanPrinting

/** A store whose catalog has the one op card, with server ids as given. */
function opStore(
  o: {
    prefixes?: string[]
    serverIds?: Record<number, number>
    over?: Partial<PhoneStore>
  } = {}
): ReturnType<typeof fakeStore> {
  const { prefixes = ['OP01', 'OP02', 'ST01'], serverIds = { 501: 9000, 502: 9001 } } = o
  const store = fakeStore({
    printingPhotoIds: vi.fn(async (ids: number[]) =>
      ids
        .filter((id) => serverIds[id] !== undefined)
        .map((id): [number, number] => [id, serverIds[id]])
    ),
    trainingSummary: vi.fn(async () => ({ total: 0, today: 0, dailyCap: 500 })),
    ...o.over
  })
  const fallback = store.invoke
  store.invoke = vi.fn(async (channel: string, args: unknown[]) => {
    if (channel === 'scan:numberPrefixes') return prefixes
    if (channel === 'scan:printingsByCode')
      return args[0] === 'OP01-001'
        ? [scanPrinting(BASE), scanPrinting(PARALLEL)]
        : args[0] === 'OP01-002'
          ? [scanPrinting(NEXT)]
          : []
    if (channel === 'cards:get') return args[0] === CARD_ID ? DETAIL : null
    return fallback(channel as never, args)
  }) as PhoneStore['invoke']
  return store
}

let storage: OutboxStorage
let outbox: Outbox
let grab: ReturnType<typeof vi.fn>

function renderScreen(
  store: PhoneStore,
  onClose: () => void = () => {},
  o: {
    engineFactory?: EngineFactory
    game?: GameId
    snap?: (v: HTMLVideoElement) => Promise<SnapResult>
  } = {}
): ReturnType<typeof renderWithProviders> {
  installPhoneApi(store)
  return renderWithProviders(
    <PhoneContext.Provider value={{ store, user: SETO, signedOut: () => {} }}>
      <ScanHubProvider>
        <ContributeScreen
          game={o.game ?? 'op'}
          onClose={onClose}
          outbox={outbox}
          grab={grab as (v: HTMLVideoElement) => Promise<ArrayBuffer>}
          now={() => NOW}
          engineFactory={o.engineFactory ?? (() => fakeEngine())}
          readPauseMs={5}
          snap={o.snap}
        />
      </ScanHubProvider>
    </PhoneContext.Provider>,
    { api: window.api }
  )
}

/** An engine whose frames' number band reads texts(n) (n counts from 0). */
function readingEngine(texts: (n: number) => string[]): {
  engine: FakeEngine
  factory: Mock<EngineFactory>
} {
  const engine = fakeEngine((n) => ({ ...NOTHING, found: true, codeTexts: texts(n) }))
  return { engine, factory: vi.fn<EngineFactory>(() => engine) }
}

const suggestion = (n: string): HTMLElement | null =>
  screen.queryByRole('button', { name: `Use ${n}` })

const numberBox = (): HTMLElement => screen.getByRole('textbox', { name: 'Card number' })
const shutter = (): HTMLElement => screen.getByRole('button', { name: 'Take photo' })

/** Types the number and picks the version labelled `rarity`. */
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  rarity: string,
  typed = 'op01001'
): Promise<void> {
  if ((numberBox() as HTMLInputElement).value === '') await user.type(numberBox(), typed)
  await user.click(await screen.findByRole('button', { name: rarity }))
}

async function uploads(): Promise<{ id: string; label: TrainingLabel }[]> {
  return (await storage.all())
    .filter((i) => i.kind === 'upload')
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    .map((i) => ({ id: i.id, label: i.label! }))
}

beforeEach(() => {
  localStorage.clear()
  stubVideo()
  stubCamera()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  setOnline(true)
  vi.stubGlobal('__APP_VERSION__', '0.53.0')
  storage = memoryOutboxStorage()
  // Distinct, ordered queue times, so the stack and the queue agree.
  let tick = 0
  outbox = createOutbox(storage, () => new Date(NOW.getTime() + tick++))
  grab = vi.fn(async () => JPEG())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

describe('contribute photos screen', () => {
  it('typed number lists its versions', async () => {
    const user = userEvent.setup()
    renderScreen(opStore())
    expect(numberBox()).toHaveAttribute('placeholder', 'OP05-119')
    expect(numberBox()).toHaveAttribute('autocapitalize', 'characters')
    expect(numberBox()).toHaveAttribute('inputmode', 'text')
    await user.type(numberBox(), 'op01001')

    const base = await screen.findByRole('button', { name: 'L' })
    const parallel = screen.getByRole('button', { name: 'L (Alternate Art)' })
    expect(screen.queryByRole('button', { name: 'P' })).not.toBeInTheDocument()
    expect(base.querySelector('img')).toHaveAttribute('src', cardImageSrc('small', 7001))
    expect(parallel.querySelector('img')).toHaveAttribute('src', cardImageSrc('small', 7002))
    expect(within(base).getByText('Romance Dawn')).toBeInTheDocument()
  })

  it('a number with no card says so', async () => {
    const user = userEvent.setup()
    renderScreen(opStore())
    await user.type(numberBox(), 'OP09-999')
    expect(await screen.findByText(NO_VERSIONS)).toBeInTheDocument()
  })

  it('set-code chips complete the prefix', async () => {
    const user = userEvent.setup()
    renderScreen(opStore())
    await user.type(numberBox(), 'op')
    const one = await screen.findByRole('button', { name: 'OP01-' })
    expect(screen.getByRole('button', { name: 'OP02-' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ST01-' })).not.toBeInTheDocument()
    await user.click(one)
    expect(numberBox()).toHaveValue('OP01-')
  })

  it('shutter waits for a synced version', async () => {
    const user = userEvent.setup()
    renderScreen(opStore({ serverIds: {} }))
    expect(shutter()).toBeDisabled()
    await choose(user, 'L')
    expect(await screen.findByText(NOT_SYNCED)).toBeInTheDocument()
    expect(shutter()).toBeDisabled()
  })

  it('each shot carries its own label', async () => {
    const user = userEvent.setup()
    const store = opStore({
      over: {
        trainingUpload: vi.fn(async () => ({ ok: false, retry: true, reason: 'offline' }) as const)
      }
    })
    renderScreen(store)
    await choose(user, 'L (Alternate Art)')
    await user.click(screen.getByRole('button', { name: 'Sleeve' }))
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    await waitFor(async () => expect(await uploads()).toHaveLength(1))
    await user.click(shutter())
    await waitFor(async () => expect(await uploads()).toHaveLength(2))

    const label: TrainingLabel = {
      game: 'op',
      cardId: CARD_ID,
      printingId: 9001,
      holder: 'sleeve',
      device: await deviceModel(),
      appVersion: '0.53.0',
      takenAt: NOW.toISOString()
    }
    const [a, b] = await uploads()
    expect(a.label).toEqual(label)
    expect(b.label).toEqual(label)
    expect(a.id).not.toBe(b.id)

    await user.click(screen.getByRole('button', { name: 'Top loader' }))
    await user.click(shutter())
    await waitFor(async () => expect(await uploads()).toHaveLength(3))
    const all = await uploads()
    expect(all[2].label).toEqual({ ...label, holder: 'toploader' })
    expect(all[0].label).toEqual(label)
    expect(all[1].label).toEqual(label)
  })

  it('a grab that fails says so and queues nothing', async () => {
    const user = userEvent.setup()
    grab.mockRejectedValueOnce(new Error('no-frame'))
    renderScreen(opStore())
    await choose(user, 'L')
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    expect(await screen.findByText(GRAB_FAILED)).toBeInTheDocument()
    expect(await uploads()).toHaveLength(0)
  })

  it('holder sticks across a remount', async () => {
    const user = userEvent.setup()
    const first = renderScreen(opStore())
    expect(screen.getByRole('button', { name: 'Bare' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Slab' }))
    first.unmount()
    renderScreen(opStore())
    expect(screen.getByRole('button', { name: 'Slab' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Bare' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a stored holder that is not one falls back to bare', () => {
    localStorage.setItem('training.holder', 'binder')
    renderScreen(opStore())
    expect(screen.getByRole('button', { name: 'Bare' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('delete last photo forgets the newest shot', async () => {
    const user = userEvent.setup()
    const store = opStore({
      over: {
        trainingUpload: vi.fn(async () => ({ ok: false, retry: true, reason: 'offline' }) as const)
      }
    })
    renderScreen(store)
    const forget = vi.spyOn(outbox, 'forget')
    const count = (): HTMLElement => screen.getByRole('status', { name: 'Photo count' })
    const del = (): HTMLElement => screen.getByRole('button', { name: 'Delete last photo' })
    expect(del()).toBeDisabled()
    await choose(user, 'L')
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    await user.click(shutter())
    await waitFor(() => expect(count()).toHaveTextContent('2 waiting to upload'))
    const [first, second] = await uploads()

    await user.click(del())
    await waitFor(() => expect(count()).toHaveTextContent('1 waiting to upload'))
    expect(forget).toHaveBeenLastCalledWith(SETO.id, second.id)
    await user.click(del())
    await waitFor(() => expect(count()).not.toHaveTextContent('waiting'))
    expect(forget).toHaveBeenLastCalledWith(SETO.id, first.id)
    expect(del()).toBeDisabled()
  })

  it('count shows server total and waiting', async () => {
    await outbox.addUpload(SETO.id, crypto.randomUUID(), {} as TrainingLabel, JPEG())
    const store = opStore({
      over: { trainingSummary: vi.fn(async () => ({ total: 12, today: 3, dailyCap: 500 })) }
    })
    renderScreen(store)
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Photo count' })).toHaveTextContent(
        '12 photos · 1 waiting to upload · 3/500 today'
      )
    )
    expect(store.trainingSummary).toHaveBeenCalledWith('op')
  })

  it('daily cap message', async () => {
    const user = userEvent.setup()
    const store = opStore({
      over: {
        trainingUpload: vi.fn(
          async () => ({ ok: false, retry: true, reason: 'daily-cap' }) as const
        )
      }
    })
    renderScreen(store)
    await choose(user, 'L')
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    expect(await screen.findByText(CAP_REACHED)).toBeInTheDocument()
  })

  it('offline says the photos wait', async () => {
    const user = userEvent.setup()
    const store = opStore({
      over: {
        trainingUpload: vi.fn(async () => ({ ok: false, retry: true, reason: 'offline' }) as const)
      }
    })
    renderScreen(store)
    await choose(user, 'L')
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    expect(await screen.findByText(OFFLINE_WAIT)).toBeInTheDocument()
  })

  it('a photo the server refuses is reported', async () => {
    const user = userEvent.setup()
    const store = opStore({
      over: {
        trainingUpload: vi.fn(
          async () => ({ ok: false, retry: false, reason: 'rejected' }) as const
        )
      }
    })
    renderScreen(store)
    await choose(user, 'L')
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    expect(await screen.findByText(DROPPED)).toBeInTheDocument()
  })

  it('drains again every 30 s while something waits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await outbox.addUpload(SETO.id, crypto.randomUUID(), {} as TrainingLabel, JPEG())
    const upload = vi.fn(async () => ({ ok: false, retry: true, reason: 'offline' }) as const)
    renderScreen(opStore({ over: { trainingUpload: upload } }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const before = upload.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(upload.mock.calls.length).toBe(before + 1)
  })

  it('next card clears the number and the version, and keeps the holder', async () => {
    const user = userEvent.setup()
    renderScreen(opStore())
    await user.click(screen.getByRole('button', { name: 'Magnetic case' }))
    await choose(user, 'L')
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Next card' }))
    expect(numberBox()).toHaveValue('')
    expect(shutter()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Magnetic case' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('shows what to shoot, and Close closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderScreen(opStore(), onClose)
    for (const line of WHAT_TO_SHOOT) expect(screen.getByText(line)).toBeInTheDocument()
    expect(WHAT_TO_SHOOT).toEqual([
      'A spread of sets and rarities: Leaders, Characters, Events, Stages and DON!!.',
      'Every version you have of the same number, side by side: alternate arts and the base card, plain Parallel foils, SP, manga, Treasure Rare.',
      "Sleeves and top loaders too, since that's how you'll stream.",
      'A few angles of each: straight on, tilted, under a light.'
    ])
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('copy is the brief’s', () => {
    expect(NO_VERSIONS).toBe('No card with that number in your card data.')
    expect(NOT_SYNCED).toBe("This version isn't synced yet. Sync, then try again.")
    expect(GRAB_FAILED).toBe("Couldn't take the photo. Try again.")
    expect(CAP_REACHED).toBe('Daily limit reached. The rest upload tomorrow.')
    expect(OFFLINE_WAIT).toBe("Offline: photos upload when you're back online.")
    expect(DROPPED).toBe('A photo was refused by the server and removed.')
  })
})

describe('reading the number off the camera', () => {
  it('fills in a number that reads twice running and is in the catalog', async () => {
    const { engine, factory } = readingEngine(() => ['OP01-001L1', ''])
    renderScreen(opStore(), undefined, { engineFactory: factory })
    await waitFor(() => expect(numberBox()).toHaveValue('OP01-001'))
    expect(factory).toHaveBeenCalledWith('op')
    expect(engine.init).toHaveBeenCalledWith(null)
    // Only the number band is read, off the live camera, as text.
    expect(engine.analyze.mock.calls[0][1]).toEqual({
      candidates: null,
      wantText: true,
      codesOnly: true
    })
    expect(await screen.findByRole('button', { name: 'L' })).toBeInTheDocument()
    // The phone fills it in: no tap to use it.
    expect(suggestion('OP01-001')).not.toBeInTheDocument()
  })

  it('a number read once, between misses, is not filled in', async () => {
    const { engine, factory } = readingEngine((n) => (n % 2 === 0 ? ['OP01-001'] : ['HAT CREW']))
    renderScreen(opStore(), undefined, { engineFactory: factory })
    await waitFor(() => expect(engine.analyze.mock.calls.length).toBeGreaterThan(6))
    expect(numberBox()).toHaveValue('')
  })

  it('a number the catalog does not have is not filled in', async () => {
    const { engine, factory } = readingEngine(() => ['OP02-999'])
    const store = opStore()
    renderScreen(store, undefined, { engineFactory: factory })
    await waitFor(() => expect(engine.analyze.mock.calls.length).toBeGreaterThan(4))
    expect(numberBox()).toHaveValue('')
    expect(store.invoke).toHaveBeenCalledWith('scan:printingsByCode', ['OP02-999'])
  })

  it('never touches what the tester typed, and stops reading while there is text', async () => {
    const user = userEvent.setup()
    const { engine, factory } = readingEngine(() => ['OP01-001'])
    renderScreen(opStore(), undefined, { engineFactory: factory })
    await user.type(numberBox(), 'OP0')
    const calls = engine.analyze.mock.calls.length
    await new Promise((r) => setTimeout(r, 60))
    expect(engine.analyze.mock.calls.length).toBeLessThanOrEqual(calls + 1)
    expect(numberBox()).toHaveValue('OP0')
  })

  it('keeps reading after a number it read: the next card replaces it, and shots go on between', async () => {
    const user = userEvent.setup()
    let card = 'OP01-001'
    const { factory } = readingEngine(() => [card])
    renderScreen(opStore(), undefined, { engineFactory: factory })
    await waitFor(() => expect(numberBox()).toHaveValue('OP01-001'))
    await user.click(await screen.findByRole('button', { name: 'L' }))
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    // The same card still in front of the camera keeps its number and version.
    await new Promise((r) => setTimeout(r, 40))
    expect(numberBox()).toHaveValue('OP01-001')
    expect(screen.getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'true')
    card = 'OP01-002'
    await waitFor(() => expect(numberBox()).toHaveValue('OP01-002'))
    // Its one version is picked without a tap.
    expect(await screen.findByRole('button', { name: 'C' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the number it read once the card has gone', async () => {
    let texts = ['OP01-001']
    const { engine, factory } = readingEngine(() => texts)
    renderScreen(opStore(), undefined, { engineFactory: factory })
    await waitFor(() => expect(numberBox()).toHaveValue('OP01-001'))
    texts = []
    const calls = engine.analyze.mock.calls.length
    await waitFor(() => expect(engine.analyze.mock.calls.length).toBeGreaterThan(calls + 6))
    expect(numberBox()).toHaveValue('OP01-001')
  })

  it('after Next card, the card just done is not read again until another is seen', async () => {
    const user = userEvent.setup()
    let card = 'OP01-001'
    const { engine, factory } = readingEngine(() => [card])
    renderScreen(opStore(), undefined, { engineFactory: factory })
    await waitFor(() => expect(numberBox()).toHaveValue('OP01-001'))
    await user.click(screen.getByRole('button', { name: 'Next card' }))
    expect(numberBox()).toHaveValue('')
    const calls = engine.analyze.mock.calls.length
    await waitFor(() => expect(engine.analyze.mock.calls.length).toBeGreaterThan(calls + 4))
    expect(numberBox()).toHaveValue('')
    // Another card in the frame (not in the catalog), then the first one back again.
    card = 'OP02-024'
    const switched = engine.analyze.mock.calls.length
    await waitFor(() => expect(engine.analyze.mock.calls.length).toBeGreaterThan(switched + 2))
    card = 'OP01-001'
    await waitFor(() => expect(numberBox()).toHaveValue('OP01-001'))
  })

  it('an engine that fails says nothing, and typing still works', async () => {
    const user = userEvent.setup()
    const engine = fakeEngine(() => new Error('no worker'))
    engine.init.mockRejectedValue(new Error('no OpenCV'))
    renderScreen(opStore(), undefined, { engineFactory: () => engine })
    await user.type(numberBox(), 'op01001')
    expect(await screen.findByRole('button', { name: 'L' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("other games' contribute screens don't read numbers", async () => {
    const factory = vi.fn<EngineFactory>(() => fakeEngine())
    renderScreen(opStore(), undefined, { engineFactory: factory, game: 'pkm' })
    await new Promise((r) => setTimeout(r, 30))
    expect(factory).not.toHaveBeenCalled()
  })

  it('stops the engine on close', async () => {
    const { engine, factory } = readingEngine(() => [])
    const view = renderScreen(opStore(), undefined, { engineFactory: factory })
    await waitFor(() => expect(engine.analyze).toHaveBeenCalled())
    view.unmount()
    expect(engine.dispose).toHaveBeenCalled()
  })
})

describe('the guide box reads by itself', () => {
  it('fills in the number held in the box twice running, with no button to press', async () => {
    const snap = vi.fn(async (): Promise<SnapResult> => ({ number: 'OP01-001' }))
    renderScreen(opStore(), () => {}, { snap })
    await waitFor(() => expect(numberBox()).toHaveValue('OP01-001'))
    expect(snap.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByRole('button', { name: 'L' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Read number' })).not.toBeInTheDocument()
  })

  it('one read between misses is not enough', async () => {
    let n = 0
    const snap = vi.fn(async (): Promise<SnapResult> =>
      n++ % 2 === 0 ? { number: 'OP01-001' } : { problem: 'none' }
    )
    renderScreen(opStore(), () => {}, { snap })
    await waitFor(() => expect(snap.mock.calls.length).toBeGreaterThan(6))
    expect(numberBox()).toHaveValue('')
  })

  it('nothing, several numbers, or a read that throws stay quiet', async () => {
    const results: (SnapResult | Error)[] = [
      { problem: 'none' },
      { problem: 'many' },
      new Error('ocr down')
    ]
    let n = 0
    const snap = vi.fn(async (): Promise<SnapResult> => {
      const r = results[n++ % results.length]
      if (r instanceof Error) throw r
      return r
    })
    renderScreen(opStore(), () => {}, { snap })
    await waitFor(() => expect(snap.mock.calls.length).toBeGreaterThan(6))
    expect(numberBox()).toHaveValue('')
    expect(screen.queryByText(SNAP_NONE)).not.toBeInTheDocument()
    expect(screen.queryByText(SNAP_MANY)).not.toBeInTheDocument()
  })

  it('stops while the tester types', async () => {
    const user = userEvent.setup()
    const snap = vi.fn(async (): Promise<SnapResult> => ({ problem: 'none' }))
    renderScreen(opStore(), () => {}, { snap })
    await user.type(numberBox(), 'OP0')
    const calls = snap.mock.calls.length
    await new Promise((r) => setTimeout(r, 60))
    expect(snap.mock.calls.length).toBeLessThanOrEqual(calls + 1)
  })

  it("other games' screens have no Read number", async () => {
    renderScreen(opStore(), () => {}, { game: 'pkm' })
    await screen.findByRole('textbox', { name: 'Card number' })
    expect(screen.queryByRole('button', { name: 'Read number' })).not.toBeInTheDocument()
  })
})

describe('shot feedback', () => {
  it('counts the shots of the chosen version and shows the last one in the tray', async () => {
    const user = userEvent.setup()
    let n = 0
    // jsdom has no object URLs; the class gets them for this test only.
    const made = vi.fn(() => `blob:shot-${++n}`)
    const revoked = vi.fn()
    Object.assign(URL, { createObjectURL: made, revokeObjectURL: revoked })
    onTestFinished(() => {
      delete (URL as Partial<typeof URL>).createObjectURL
      delete (URL as Partial<typeof URL>).revokeObjectURL
    })
    renderScreen(opStore())
    await choose(user, 'L')
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    expect(await screen.findByText('1 shot of this version')).toBeInTheDocument()
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.click(shutter())
    expect(await screen.findByText('2 shots of this version')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Last photo' })).toHaveAttribute('src', 'blob:shot-2')

    await user.click(screen.getByRole('button', { name: 'Delete last photo' }))
    expect(await screen.findByText('1 shot of this version')).toBeInTheDocument()
    expect(revoked).toHaveBeenCalledWith('blob:shot-2')
    expect(screen.getByRole('img', { name: 'Last photo' })).toHaveAttribute('src', 'blob:shot-1')
  })
})
