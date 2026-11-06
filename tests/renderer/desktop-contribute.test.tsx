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
import { fakeEngine, stubCamera, stubVideo } from './scanFakes'

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
const SERVER_IDS: Record<number, number> = { 501: 9000, 502: 9001, 504: 9004 }
const scanPrinting = (p: Printing): ScanPrinting =>
  ({ printingId: p.id, cardId: p.cardId, setCode: p.setCode, imageIds: [7001] }) as ScanPrinting

let storage: OutboxStorage
let outbox: Outbox
let deps: TrainingDeps & {
  [K in 'upload' | 'remove' | 'summary' | 'serverIds']: ReturnType<typeof vi.fn>
}

function renderDesktop(
  onClose: () => void = () => {},
  grab: (v: HTMLVideoElement) => Promise<ArrayBuffer> | Grabbed = async () => JPEG()
): void {
  const api = createMockApi({
    scan: {
      numberPrefixes: vi.fn(async () => ['OP01']),
      printingsByCode: vi.fn(async (code: string) =>
        [BASE, PARALLEL, SOLO].filter((p) => p.setCode === code).map(scanPrinting)
      )
    },
    cards: { get: vi.fn(async (id: number) => (id === CARD_ID ? DETAIL : null)) }
  })
  renderWithProviders(
    <ScanHubProvider>
      <ContributeScreen
        game="op"
        onClose={onClose}
        outbox={outbox}
        grab={grab}
        now={() => NOW}
        engineFactory={() => fakeEngine()}
        readPauseMs={5}
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
