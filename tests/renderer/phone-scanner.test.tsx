import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from '@/components/ui/sonner'
import { ScanHubProvider } from '@/features/scan/ScanHub'
import type { ScanRow } from '@/features/scan/session'
import { PhoneContext } from '../../src/phone/context'
import { ScannerScreen } from '../../src/phone/ScannerScreen'
import { createSyncTriggers } from '../../src/phone/syncTriggers'
import type { PhoneStore } from '../../src/phone/data/store'
import { renderWithProviders } from './mockApi'
import { SETO, fakeStore, installPhoneApi, setOnline } from './phoneFakes'
import { fakeEngine, printing, stubCamera, stubVideo } from './scanFakes'

const SESSION_KEY = 'scan.session.v1'

const row = (o: Partial<ScanRow> = {}): ScanRow => ({
  key: '101:46986414',
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

beforeEach(() => {
  localStorage.clear()
  stubVideo()
  camera = stubCamera()
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

function renderScanner(store: PhoneStore): ReturnType<typeof renderWithProviders> {
  const engine = fakeEngine()
  return renderWithProviders(
    <PhoneContext.Provider value={{ store, user: SETO, signedOut: () => {} }}>
      <ScanHubProvider>
        <ScannerScreen engineFactory={() => engine} onClose={() => {}} onOpenSettings={() => {}} />
        <Toaster />
      </ScanHubProvider>
    </PhoneContext.Provider>,
    { api: window.api }
  )
}

const settle = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

describe('phone scanner', () => {
  it('Add to collection adds each row through the store and triggers one sync', async () => {
    vi.useFakeTimers()
    // Testing Library's async wrapper only advances fake timers it believes are Jest's.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify([
        row(),
        row({ key: '102:46986414', printingId: 102, setCode: 'SDY-006', quantity: 2 })
      ])
    )
    const store = fakeStore({
      invoke: vi.fn(async (channel: string) => (channel === 'collection:add' ? { id: 1 } : []))
    })
    const { api } = installPhoneApi(store, () => triggers.afterAdd())
    const triggers = createSyncTriggers({
      sync: () => api.account.syncNow(),
      online: () => navigator.onLine,
      on: () => () => {},
      setTimer: setTimeout,
      clearTimer: clearTimeout
    })
    renderScanner(store)
    await settle()

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: 'Review 3 scanned' }))
    const list = screen.getByRole('region', { name: 'This session' })
    await user.click(within(list).getByRole('button', { name: 'Add 3 cards to collection' }))
    await settle()

    const adds = vi.mocked(store.invoke).mock.calls.filter(([c]) => c === 'collection:add')
    expect(adds).toEqual([
      ['collection:add', [{ printingId: 101, imageId: 46986414, quantity: 1 }]],
      ['collection:add', [{ printingId: 102, imageId: 46986414, quantity: 2 }]]
    ])
    expect(store.sync).not.toHaveBeenCalled()
    await settle(2_000)
    expect(store.sync).toHaveBeenCalledTimes(1)
    triggers.dispose()
  })

  it('opens the rear camera', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    renderScanner(store)
    await vi.waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled())
    expect(camera.getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } })
      })
    )
  })

  it('torch button shows only when the track reports torch', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    const first = renderScanner(store)
    await vi.waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Flashlight' })).not.toBeInTheDocument()
    first.unmount()

    const applyConstraints = vi.fn(async () => undefined)
    Object.assign(camera.track, {
      getCapabilities: () => ({ torch: true }),
      applyConstraints
    })
    const user = userEvent.setup()
    renderScanner(store)
    const torch = await screen.findByRole('button', { name: 'Flashlight' })
    expect(torch).toHaveAttribute('aria-pressed', 'false')
    await user.click(torch)
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: true }] })
    expect(torch).toHaveAttribute('aria-pressed', 'true')
    await user.click(torch)
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] })
  })

  it('shows the Language, Set and New scans as pickers and the close and settings buttons', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    renderScanner(store)
    expect(await screen.findByRole('combobox', { name: 'Set' })).toHaveTextContent('Any set')
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English')
    expect(screen.getByRole('combobox', { name: 'New scans as' })).toHaveTextContent('Auto rarity')
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close scanner' })).toBeInTheDocument()
  })

  it('keeps the close and settings buttons when the camera fails', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException('no camera', 'NotFoundError')
        }),
        enumerateDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    })
    const store = fakeStore()
    installPhoneApi(store)
    renderScanner(store)
    expect(await screen.findByText("This phone's camera didn't open.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close scanner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  // jsdom has no layout, so this pins the structure that makes the rows fit: the camera is the one
  // part of the column that shrinks, at 3:4 within whatever room is left, and every other row
  // keeps its height. (Checked by eye in Task 13 at 390x844 and 375x667.)
  it('the camera gives way so the last scan, chips and footer always fit', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    const { container } = renderScanner(store)
    const review = await screen.findByRole('button', { name: 'Review 0 scanned' })
    const camera = screen.getByRole('region', { name: 'Camera' })
    const column = camera.parentElement!
    expect(camera).toHaveClass('min-h-0', 'flex-1')

    const stage = camera.querySelector('[data-camera-stage]')!
    expect(stage).toHaveClass('min-h-0', 'flex-1', '[container-type:size]')
    const viewport = container.querySelector('video:not([aria-hidden])')!.parentElement!
    expect(stage.contains(viewport)).toBe(true)
    // 3:4 at the largest size that fits the stage, so the scanned crop is what the preview shows.
    expect(viewport).toHaveClass('aspect-[3/4]', 'w-[min(100cqw,75cqh)]')
    // The gear rides on the preview, not on a row of its own.
    expect(viewport.contains(screen.getByRole('button', { name: 'Settings' }))).toBe(true)

    const picker = screen.getByRole('combobox', { name: 'Set' })
    const last = screen.getByRole('region', { name: 'Last scan' })
    const rows = [...column.children].filter((c) => c !== camera)
    for (const el of [review, picker, last]) {
      expect(camera.contains(el)).toBe(false)
      const row = rows.find((r) => r.contains(el))!
      expect(row).toHaveClass('shrink-0')
    }
  })

  describe('last scan card and footer', () => {
    const forCard = (entries: { printingId: number; quantity: number }[]): PhoneStore['invoke'] =>
      vi.fn(async (channel: string) =>
        channel === 'collection:forCard'
          ? entries.map((e, i) => ({
              id: i + 1,
              quantity: e.quantity,
              printing: { id: e.printingId }
            }))
          : []
      ) as unknown as PhoneStore['invoke']

    const three = [
      printing(),
      printing({
        printingId: 102,
        setCode: 'SDY-006',
        rarity: 'Super Rare',
        setName: 'Starter Deck: Yugi'
      }),
      printing({ printingId: 103, setCode: 'LOB-EN005', rarity: 'Secret Rare' })
    ]

    it('shows a quiet empty state when nothing is scanned', async () => {
      const store = fakeStore()
      installPhoneApi(store)
      renderScanner(store)
      const card = await screen.findByRole('region', { name: 'Last scan' })
      expect(card).toHaveTextContent('Scanned cards show up here')
      expect(card).toHaveClass('min-h-28')
      expect(screen.getByText('0 cards')).toBeInTheDocument()
      expect(screen.queryByLabelText('Value of this scan')).not.toBeInTheDocument()
    })

    it('shows the newest row with its set, price, rarity, flag and owned count', async () => {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify([
          row({ key: 'old', name: 'Kuriboh', cardId: 2, addedAt: 5 }),
          row({
            addedAt: 9,
            quantity: 3,
            flag: 'check-rarity',
            options: [printing({ price: 12.5 })]
          })
        ])
      )
      const store = fakeStore({
        invoke: forCard([
          { printingId: 101, quantity: 2 },
          { printingId: 999, quantity: 4 }
        ])
      })
      installPhoneApi(store)
      renderScanner(store)
      const card = await screen.findByRole('region', { name: 'Last scan' })
      expect(within(card).getByText('Dark Magician')).toBeInTheDocument()
      expect(card).toHaveTextContent('LOB-EN005 · Legend of Blue Eyes White Dragon')
      expect(within(card).getByLabelText('Price of Dark Magician')).toHaveTextContent('$12.50')
      expect(card).toHaveTextContent('Ultra Rare')
      expect(card).toHaveTextContent('Check rarity')
      expect(await within(card).findByText('Own 2 · ×3 this scan')).toBeInTheDocument()
      // One printing to choose from: no cycle button.
      expect(
        within(card).queryByRole('button', { name: 'Next printing of Dark Magician' })
      ).not.toBeInTheDocument()
    })

    it('says Not owned when the collection has none of the printing', async () => {
      localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
      const store = fakeStore({ invoke: forCard([{ printingId: 102, quantity: 1 }]) })
      installPhoneApi(store)
      renderScanner(store)
      const card = await screen.findByRole('region', { name: 'Last scan' })
      expect(await within(card).findByText('Not owned · ×1 this scan')).toBeInTheDocument()
    })

    it('cycles the printing and wraps around', async () => {
      const user = userEvent.setup()
      localStorage.setItem(SESSION_KEY, JSON.stringify([row({ via: 'art', options: three })]))
      const store = fakeStore()
      installPhoneApi(store)
      renderScanner(store)
      const card = await screen.findByRole('region', { name: 'Last scan' })
      const next = within(card).getByRole('button', { name: 'Next printing of Dark Magician' })
      expect(next).toHaveTextContent('1/3')
      await user.click(next)
      expect(card).toHaveTextContent('SDY-006 · Starter Deck: Yugi')
      expect(card).toHaveTextContent('Super Rare')
      expect(next).toHaveTextContent('2/3')
      await user.click(next)
      expect(card).toHaveTextContent('Secret Rare')
      expect(next).toHaveTextContent('3/3')
      await user.click(next)
      expect(card).toHaveTextContent('Ultra Rare')
      expect(next).toHaveTextContent('1/3')
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!) as ScanRow[]
      expect(saved.map((r) => r.printingId)).toEqual([101])
    })

    it('removes the row', async () => {
      const user = userEvent.setup()
      localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
      const store = fakeStore()
      installPhoneApi(store)
      renderScanner(store)
      const card = await screen.findByRole('region', { name: 'Last scan' })
      await user.click(within(card).getByRole('button', { name: 'Remove Dark Magician' }))
      expect(screen.getByRole('region', { name: 'Last scan' })).toHaveTextContent(
        'Scanned cards show up here'
      )
      expect(screen.getByRole('button', { name: 'Review 0 scanned' })).toBeInTheDocument()
    })

    it('footer counts the cards, totals known prices, and its button opens the review sheet', async () => {
      const user = userEvent.setup()
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify([
          row({ quantity: 2, options: [printing({ price: 10 })] }),
          row({
            key: 'b',
            printingId: 102,
            setCode: 'SDY-006',
            options: [printing({ printingId: 102, price: 1.25 })]
          }),
          row({
            key: 'c',
            cardId: 3,
            name: 'Kuriboh',
            printingId: 103,
            options: [printing({ printingId: 103 })]
          })
        ])
      )
      const store = fakeStore()
      installPhoneApi(store)
      renderScanner(store)
      expect(await screen.findByText('4 cards')).toBeInTheDocument()
      expect(screen.getByLabelText('Value of this scan')).toHaveTextContent('$21.25')
      expect(screen.queryByRole('region', { name: 'This session' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Review 4 scanned' }))
      expect(screen.getByRole('region', { name: 'This session' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Close review' }))
      expect(screen.queryByRole('region', { name: 'This session' })).not.toBeInTheDocument()
    })

    it('says 1 card for one', async () => {
      localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
      const store = fakeStore()
      installPhoneApi(store)
      renderScanner(store)
      expect(await screen.findByText('1 card')).toBeInTheDocument()
    })
  })
})
