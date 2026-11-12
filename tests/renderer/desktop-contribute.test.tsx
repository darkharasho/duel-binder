import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import type { CardDetail, Printing } from '@shared/types'
import type { ScanPrinting } from '@shared/scan/types'
import { ContributeScreen, type TrainingDeps } from '../../src/phone/training/ContributeScreen'
import {
  createOutbox,
  memoryOutboxStorage,
  type Outbox,
  type OutboxStorage
} from '../../src/phone/training/outbox'
import App from '@/App'
import type { AccountStatus } from '@shared/types'
import type { Grabbed } from '../../src/phone/training/capture'
import { createMockApi, renderWithProviders } from './mockApi'
import { NOTHING, fakeEngine, stubCamera, stubVideo } from './scanFakes'
import type { EngineFactory } from '@/features/scan/engine'
import type { SnapResult } from '../../src/phone/training/numberSnap'
import { SNAP_MANY, SNAP_NONE } from '../../src/phone/training/copy'

const CARD_ID = 2 ** 39 + 5
const NOW = new Date('2026-11-05T12:00:00.000Z')
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
/** The only version of its number. */
const SOLO = printing({ id: 504, setCode: 'OP01-002', setRarity: 'SR' })
const DETAIL: CardDetail = {
  card: { id: CARD_ID, name: 'Roronoa Zoro' } as CardDetail['card'],
  printings: [BASE, PARALLEL, SOLO],
  images: [{ imageId: 7001, cardId: CARD_ID, sortOrder: 0 }]
}
const MTG_CARD = 2 ** 38 + 1005
const mtg = (o: Partial<Printing>): Printing =>
  printing({ id: 601, cardId: MTG_CARD, setName: 'Modern Horizons 3', setCode: 'MH3 123', setRarity: 'Rare', ...o })
const MTG_RARE = mtg({})
const MTG_FOIL = mtg({ id: 602, setRarity: 'Rare (Foil)' })
const MTG_DETAIL: CardDetail = {
  card: { id: MTG_CARD, name: 'Siren Lookout' } as CardDetail['card'],
  printings: [MTG_RARE, MTG_FOIL],
  images: [{ imageId: 8001, cardId: MTG_CARD, sortOrder: 0 }]
}
const SERVER_IDS: Record<number, number> = { 501: 9000, 502: 9001, 504: 9004, 601: 9100, 602: 9101 }
const scanPrinting = (p: Printing): ScanPrinting =>
  ({ printingId: p.id, cardId: p.cardId, setCode: p.setCode, imageIds: [7001] }) as ScanPrinting

let storage: OutboxStorage
let outbox: Outbox
let deps: TrainingDeps & {
  [K in 'upload' | 'remove' | 'summary' | 'serverIds']: ReturnType<typeof vi.fn>
}

function renderDesktop(
  onClose: () => void = () => {},
  grab: (v: HTMLVideoElement) => Promise<ArrayBuffer> | Grabbed = async () => JPEG(),
  o: {
    engineFactory?: EngineFactory
    snap?: (v: HTMLVideoElement) => Promise<SnapResult>
    game?: 'op' | 'mtg'
  } = {}
): ReturnType<typeof renderWithProviders> {
  const api = createMockApi({
    scan: {
      numberPrefixes: vi.fn(async () => (o.game === 'mtg' ? ['MH3'] : ['OP01'])),
      printingsByCode: vi.fn(async (code: string) =>
        [BASE, PARALLEL, SOLO, MTG_RARE, MTG_FOIL]
          .filter((p) => p.setCode.toLowerCase() === code.toLowerCase())
          .map(scanPrinting)
      )
    },
    cards: {
      get: vi.fn(async (id: number) => (id === CARD_ID ? DETAIL : id === MTG_CARD ? MTG_DETAIL : null))
    }
  })
  return renderWithProviders(
    <ScanHubProvider>
      <ContributeScreen
        game={o.game ?? 'op'}
        onClose={onClose}
        outbox={outbox}
        grab={grab}
        now={() => NOW}
        engineFactory={o.engineFactory ?? (() => fakeEngine())}
        readPauseMs={5}
        snap={o.snap}
        deps={deps}
        layout="desktop"
      />
    </ScanHubProvider>,
    { api }
  )
}

const numberBox = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: 'Card number' }) as HTMLInputElement
const shutter = (): HTMLElement => screen.getByRole('button', { name: 'Take photo' })
const waiting = async (): Promise<number> =>
  (await storage.all()).filter((i) => i.kind === 'upload').length

beforeEach(() => {
  localStorage.clear()
  stubVideo()
  stubCamera()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.stubGlobal('__APP_VERSION__', '0.59.0')
  storage = memoryOutboxStorage()
  let tick = 0
  outbox = createOutbox(storage, () => new Date(NOW.getTime() + tick++))
  deps = {
    userId: 1,
    upload: vi.fn(async () => ({ ok: false, retry: true, reason: 'offline' }) as const),
    remove: vi.fn(async () => ({ ok: true, summary: null }) as const),
    summary: vi.fn(async () => ({ total: 4, today: 1, dailyCap: 500 })),
    serverIds: vi.fn(async (ids: number[]) =>
      ids
        .filter((id) => SERVER_IDS[id] !== undefined)
        .map((id): [number, number] => [id, SERVER_IDS[id]])
    )
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

describe('desktop contribute photos', () => {
  it('Magic: Space types the space in a code, then shoots once the code is whole', async () => {
    const user = userEvent.setup()
    renderDesktop(undefined, undefined, { game: 'mtg' })
    await user.keyboard('mh3 123')
    expect(numberBox()).toHaveValue('mh3 123')
    await user.click(await screen.findByRole('button', { name: 'Rare (Foil)' }))
    await waitFor(() => expect(shutter()).toBeEnabled())
    numberBox().focus()
    await user.keyboard(' ')
    await waitFor(async () => expect(await waiting()).toBe(1))
    expect(numberBox()).toHaveValue('mh3 123')
  })

  it('starts in the number box and picks a number with one version by itself', async () => {
    const user = userEvent.setup()
    renderDesktop()
    expect(numberBox()).toHaveFocus()
    await user.keyboard('op01002')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'SR' })).toHaveAttribute('aria-pressed', 'true')
    )
    await waitFor(() => expect(shutter()).toBeEnabled())
  })

  it('Space shoots from the number box, sends through the app, and N starts the next card', async () => {
    const user = userEvent.setup()
    renderDesktop()
    await user.keyboard('op01002')
    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.keyboard(' ')
    await waitFor(async () => expect(await waiting()).toBe(1))
    expect(numberBox()).toHaveValue('op01002')
    await waitFor(() => expect(deps.upload).toHaveBeenCalled())
    const [, label] = deps.upload.mock.calls[0]
    expect(label).toMatchObject({ game: 'op', cardId: CARD_ID, printingId: 9004, holder: 'bare' })
    expect(await screen.findByText(/4 photos/)).toBeInTheDocument()

    // Off the number box, N is Next card; typing goes straight back to the box.
    screen.getByRole('button', { name: 'Close' }).focus()
    await user.keyboard('n')
    expect(numberBox()).toHaveValue('')
    expect(numberBox()).toHaveFocus()
  })

  it('arrows pick among versions, digits pick the holder, Backspace drops the last shot', async () => {
    const user = userEvent.setup()
    renderDesktop()
    await user.keyboard('op01001')
    await screen.findByRole('button', { name: 'L' })
    screen.getByRole('button', { name: 'Close' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'L (Alternate Art)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.keyboard('2')
    expect(screen.getByRole('button', { name: /Sleeve/ })).toHaveAttribute('aria-pressed', 'true')

    await waitFor(() => expect(shutter()).toBeEnabled())
    await user.keyboard(' ')
    await waitFor(async () => expect(await waiting()).toBe(1))
    expect(deps.upload.mock.calls[0][1]).toMatchObject({ printingId: 9001, holder: 'sleeve' })
    await user.keyboard('{Backspace}')
    await waitFor(async () => expect(await waiting()).toBe(0))
  })

  it('picks the camera beside the controls; Esc in the camera list closes only the list', async () => {
    const { getUserMedia } = stubCamera()
    navigator.mediaDevices.enumerateDevices = vi.fn(async () => [
      { deviceId: 'cam1', kind: 'videoinput', label: 'Desk webcam', groupId: 'g' },
      { deviceId: 'cam2', kind: 'videoinput', label: 'Laptop camera', groupId: 'h' }
    ]) as never
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderDesktop(onClose)
    const picker = screen.getByRole('combobox', { name: 'Camera' })
    await waitFor(() => expect(picker).toHaveTextContent('Desk webcam'))
    await user.click(picker)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('combobox', { name: 'Camera' }))
    await user.click(screen.getByRole('option', { name: 'Laptop camera' }))
    await waitFor(() =>
      expect(getUserMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({ deviceId: { exact: 'cam2' } })
        })
      )
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('typing elsewhere goes to the number box, and Esc closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDesktop(onClose)
    screen.getByRole('button', { name: 'Close' }).focus()
    await user.keyboard('o')
    expect(numberBox()).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('desktop number reading: offered, and read on R', () => {
  it('offers what the camera reads for Enter or a tap, and never fills it in by itself', async () => {
    const user = userEvent.setup()
    const engine = fakeEngine(() => ({ ...NOTHING, found: true, codeTexts: ['OP01-002'] }))
    renderDesktop(undefined, undefined, { engineFactory: () => engine })
    const use = await screen.findByRole('button', { name: 'Use OP01-002' })
    expect(numberBox()).toHaveValue('')
    await user.click(use)
    expect(numberBox()).toHaveValue('OP01-002')
  })

  it('a number read once between misses, or one the catalog lacks, is not offered', async () => {
    const engine = fakeEngine((n) => ({
      ...NOTHING,
      found: true,
      codeTexts: n % 2 === 0 ? ['OP01-002'] : ['OP01-999']
    }))
    renderDesktop(undefined, undefined, { engineFactory: () => engine })
    await waitFor(() => expect(engine.analyze.mock.calls.length).toBeGreaterThan(6))
    expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
  })

  it('an engine that fails stays quiet, and it is stopped on close', async () => {
    const engine = fakeEngine(() => new Error('no worker'))
    const view = renderDesktop(undefined, undefined, { engineFactory: () => engine })
    await waitFor(() => expect(engine.analyze).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    view.unmount()
    expect(engine.dispose).toHaveBeenCalled()
  })

  it('Read number fills in the number in the box, or says what went wrong', async () => {
    const user = userEvent.setup()
    const results: SnapResult[] = [{ problem: 'none' }, { problem: 'many' }, { number: 'OP01-002' }]
    const snap = vi.fn(async () => results.shift()!)
    renderDesktop(undefined, undefined, { snap })
    // It reads only when asked.
    await new Promise((r) => setTimeout(r, 30))
    expect(snap).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Read number/ }))
    expect(await screen.findByText(SNAP_NONE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Read number/ }))
    expect(await screen.findByText(SNAP_MANY)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Read number/ }))
    await waitFor(() => expect(numberBox()).toHaveValue('OP01-002'))
  })
})

describe('shutter speed', () => {
  it('frees the shutter while a shot encodes, waits at two, and a shot deleted mid-encode is never queued', async () => {
    const user = userEvent.setup()
    const encodes: ((b: ArrayBuffer) => void)[] = []
    const grab = (): Grabbed => ({
      thumb: 'data:image/jpeg;base64,AA==',
      jpeg: new Promise<ArrayBuffer>((resolve) => encodes.push(resolve))
    })
    renderDesktop(() => {}, grab)
    await user.keyboard('op01002')
    await waitFor(() => expect(shutter()).toBeEnabled())

    await user.keyboard(' ')
    // Taken at once: in the tray, and the shutter free, before the JPEG exists.
    expect(screen.getByRole('img', { name: 'Last photo' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,AA=='
    )
    expect(shutter()).toBeEnabled()
    await user.keyboard(' ')
    expect(shutter()).toBeDisabled()
    expect(encodes).toHaveLength(2)

    // The newest is deleted while still encoding; the first finishes and is queued alone.
    screen.getByRole('button', { name: 'Close' }).focus()
    await user.keyboard('{Backspace}')
    encodes[0](JPEG())
    encodes[1](JPEG())
    await waitFor(() => expect(shutter()).toBeEnabled())
    await waitFor(async () => expect(await waiting()).toBe(1))
  })
})

describe('desktop contribute entry', () => {
  const signedIn: AccountStatus = {
    state: 'idle',
    user: { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null },
    localOwner: 'Seto',
    lastSyncedAt: null,
    error: null,
    pendingCount: 0,
    unsyncedCount: 0,
    signInRequired: false
  }

  it('a tester opens it from the sidebar, in the tester game', async () => {
    const user = userEvent.setup()
    let active = 'ygo'
    const api = createMockApi({
      account: { status: vi.fn(async () => signedIn) },
      games: {
        available: vi.fn(async () => ['ygo', 'op'] as const).bind(null) as never,
        active: vi.fn(async () => active) as never,
        setActive: vi.fn(async (g: string) => {
          active = g
        }) as never
      }
    })
    renderWithProviders(<App />, { api })
    await user.click(await screen.findByRole('button', { name: 'Contribute photos' }))
    expect(await screen.findByRole('heading', { name: 'Contribute photos' })).toBeInTheDocument()
    expect(api.games.setActive).toHaveBeenCalledWith('op')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(api.games.setActive).toHaveBeenLastCalledWith('ygo'))
    expect(screen.queryByRole('heading', { name: 'Contribute photos' })).not.toBeInTheDocument()
  })

  it('is not there without a tester game', async () => {
    const api = createMockApi({ account: { status: vi.fn(async () => signedIn) } })
    renderWithProviders(<App />, { api })
    await screen.findByRole('button', { name: 'Dashboard' })
    expect(screen.queryByRole('button', { name: 'Contribute photos' })).not.toBeInTheDocument()
  })
})
