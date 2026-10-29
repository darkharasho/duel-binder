import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from '@/components/ui/sonner'
import { ScanHubProvider, useScanHub } from '@/features/scan/ScanHub'
import type { ScanRow } from '@/features/scan/session'
import { PhoneContext } from '../../src/phone/context'
import { ScannerScreen } from '../../src/phone/ScannerScreen'
import { PhoneCamera } from '../../src/phone/PhoneCamera'
import { GameProvider } from '@/lib/game'
import { LOOK_MODEL } from '@shared/scan/lookModel'
import { createSyncTriggers } from '../../src/phone/syncTriggers'
import type { PhoneStore } from '../../src/phone/data/store'
import { createMockApi, renderWithProviders } from './mockApi'
import { SETO, fakeStore, installPhoneApi, setOnline } from './phoneFakes'
import { codeFrame, fakeBridge, fakeEngine, printing, stubCamera, stubVideo } from './scanFakes'

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

/** Counts a pull of `row()` through the hub, as the scanner does on a match. */
function FakePull(): React.JSX.Element {
  const { count } = useScanHub()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the draft is the row without these
  const { key, quantity, addedAt, ...draft } = row()
  return (
    <button type="button" onClick={() => count(draft)}>
      Fake pull
    </button>
  )
}

function renderScanner(store: PhoneStore): ReturnType<typeof renderWithProviders> {
  const engine = fakeEngine()
  return renderWithProviders(
    <PhoneContext.Provider value={{ store, user: SETO, signedOut: () => {} }}>
      <ScanHubProvider>
        <FakePull />
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
    const list = screen.getByRole('region', { name: 'Review' })
    await user.click(within(list).getByRole('button', { name: 'Add 3 cards' }))
    await settle()

    const adds = vi.mocked(store.invoke).mock.calls.filter(([c]) => c === 'collection:add')
    expect(adds).toEqual([
      [
        'collection:add',
        [{ printingId: 101, imageId: 46986414, quantity: 1, requestId: expect.any(String) }]
      ],
      [
        'collection:add',
        [{ printingId: 102, imageId: 46986414, quantity: 2, requestId: expect.any(String) }]
      ]
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
      // Kuriboh has no price: left out of the value and said so, not counted as $0.
      expect(screen.getByText('1 with no price')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Review' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Review 4 scanned' }))
      expect(screen.getByRole('region', { name: 'Review' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Close review' }))
      expect(screen.queryByRole('region', { name: 'Review' })).not.toBeInTheDocument()
    })

    it('says 1 card for one', async () => {
      localStorage.setItem(SESSION_KEY, JSON.stringify([row()]))
      const store = fakeStore()
      installPhoneApi(store)
      renderScanner(store)
      expect(await screen.findByText('1 card')).toBeInTheDocument()
    })

    it('the review sheet lists each card with its count, value, stepper and Clear', async () => {
      const user = userEvent.setup()
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify([
          row({ quantity: 2, flag: 'check-rarity', options: [printing({ price: 10 })] }),
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
      await user.click(await screen.findByRole('button', { name: 'Review 3 scanned' }))
      const sheet = screen.getByRole('region', { name: 'Review' })
      expect(sheet).toHaveTextContent('3 cards · 2 entries')
      expect(within(sheet).getByLabelText('Value of the list')).toHaveTextContent('$20.00')
      expect(sheet).toHaveTextContent('1 card with no price')
      const items = within(sheet).getAllByRole('listitem')
      expect(items).toHaveLength(2)
      expect(items[0]).toHaveTextContent('Check rarity')
      expect(
        within(sheet).getByRole('combobox', { name: 'Rarity for Dark Magician' })
      ).toHaveTextContent('Ultra Rare')

      await user.click(within(sheet).getByRole('button', { name: 'One more Kuriboh' }))
      expect(within(sheet).getByLabelText('Quantity of Kuriboh')).toHaveTextContent('2')
      await user.click(within(sheet).getByRole('button', { name: 'One fewer Dark Magician' }))
      expect(within(sheet).getByLabelText('Quantity of Dark Magician')).toHaveTextContent('1')
      await user.click(within(sheet).getByRole('button', { name: 'Remove Kuriboh' }))
      expect(within(sheet).getAllByRole('listitem')).toHaveLength(1)
      expect(within(sheet).getByRole('button', { name: 'Add 1 card' })).toBeEnabled()

      await user.click(within(sheet).getByRole('button', { name: 'Clear' }))
      await user.click(await screen.findByRole('button', { name: 'Clear list' }))
      expect(sheet).toHaveTextContent('Cards you scan show up here.')
      expect(within(sheet).getByRole('button', { name: 'Add 0 cards' })).toBeDisabled()
    })

    it("the review's printing picker lists the scan language's printings, keeping the row's own", async () => {
      const user = userEvent.setup()
      localStorage.setItem('language.filter', 'ja')
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify([
          row({
            via: 'art',
            options: [
              printing(),
              printing({ printingId: 102, setCode: 'LOB-JP005', rarity: 'Rare', language: 'ja' }),
              printing({ printingId: 103, setCode: 'SDY-006', rarity: 'Common', language: 'de' })
            ]
          })
        ])
      )
      const store = fakeStore()
      installPhoneApi(store)
      renderScanner(store)
      await user.click(await screen.findByRole('button', { name: 'Review 1 scanned' }))
      const sheet = screen.getByRole('region', { name: 'Review' })
      await user.click(within(sheet).getByRole('combobox', { name: 'Rarity for Dark Magician' }))
      const picker = screen.getByRole('dialog', { name: 'Printing' })
      expect(
        within(picker)
          .getAllByRole('option')
          .map((o) => o.textContent)
      ).toEqual(['LOB-EN005Ultra RareEN', 'LOB-JP005RareJP'])
    })

    it('a new scan pops the found bubble and buzzes; saved rows and count changes do not', async () => {
      const vibrate = vi.fn()
      vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { vibrate }))
      localStorage.setItem(SESSION_KEY, JSON.stringify([row({ addedAt: 5 })]))
      const store = fakeStore()
      installPhoneApi(store)
      const { container } = renderScanner(store)
      await screen.findByRole('region', { name: 'Last scan' })
      expect(container.querySelector('[data-found-burst]')).toBeNull()
      expect(vibrate).not.toHaveBeenCalled()

      // Changing a count by hand isn't a scan.
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Review 1 scanned' }))
      const sheet = screen.getByRole('region', { name: 'Review' })
      await user.click(within(sheet).getByRole('button', { name: 'One more Dark Magician' }))
      expect(container.querySelector('[data-found-burst]')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Close review' }))

      // A repeat scan of a card already on the list counts as found too.
      await user.click(screen.getByRole('button', { name: 'Fake pull' }))
      const burst = container.querySelector('[data-found-burst]')!
      expect(burst).toHaveTextContent('Dark Magician')
      expect(burst).toHaveAttribute('aria-hidden', 'true')
      expect(vibrate).toHaveBeenCalledTimes(1)
      await user.click(screen.getByRole('button', { name: 'Fake pull' }))
      expect(vibrate).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('button', { name: 'Review 4 scanned' })).toBeInTheDocument()
    })

    it('chips open a picker sheet with search, codes as badges, and the pick ticked', async () => {
      const user = userEvent.setup()
      const store = fakeStore()
      installPhoneApi(store)
      renderScanner(store)
      await user.click(await screen.findByRole('combobox', { name: 'New scans as' }))
      const sheet = screen.getByRole('dialog', { name: 'New scans as' })
      expect(within(sheet).getByRole('option', { name: 'Auto' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await user.type(within(sheet).getByRole('searchbox'), 'secret')
      const options = within(sheet).getAllByRole('option')
      expect(options.every((o) => /secret/i.test(o.textContent ?? ''))).toBe(true)
      await user.click(options[0])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'New scans as' })).toHaveTextContent(
        options[0].textContent!
      )

      await user.click(screen.getByRole('combobox', { name: 'Language' }))
      const languages = screen.getByRole('dialog', { name: 'Language' })
      expect(within(languages).getByRole('option', { name: /English/ })).toHaveTextContent('EN')
      await user.click(within(languages).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

describe('phone scanner on Pokémon', () => {
  const pkmGames = {
    available: vi.fn(async () => ['ygo', 'pkm'] as never),
    active: vi.fn(async () => 'pkm' as const)
  }

  it('phone scanner runs without the look model for pkm', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
    const engine = fakeEngine(() => codeFrame('045/193'))
    const factory = vi.fn(() => engine)
    const api = createMockApi({ scanWindow: fakeBridge().scanWindow, games: pkmGames })
    renderWithProviders(
      <GameProvider>
        <ScanHubProvider>
          <PhoneCamera engineFactory={factory} lookModel={LOOK_MODEL} />
        </ScanHubProvider>
      </GameProvider>,
      { api }
    )
    await settle()
    await settle(1500)
    expect(factory).toHaveBeenLastCalledWith('pkm')
    expect(api.scan.fingerprints).toHaveBeenLastCalledWith('pkm')
    expect(engine.analyze).toHaveBeenCalled()
    expect(engine.analyze.mock.calls.every(([, o]) => o.wantLook === false)).toBe(true)
  })

  it("the last scan of a Pokémon card whose version isn't sure shows no lone price", async () => {
    vi.useFakeTimers()
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) })
    const options = [
      printing({ printingId: 501, cardId: 5, name: 'Pikachu', rarity: 'Normal', price: 1 }),
      printing({
        printingId: 502,
        cardId: 5,
        name: 'Pikachu',
        rarity: 'Reverse Holofoil',
        price: 3.5
      })
    ]
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify([
        row({
          key: '501:500',
          cardId: 5,
          name: 'Pikachu',
          imageId: 500,
          printingId: 501,
          setCode: 'PAL 045/193',
          rarity: 'Normal',
          options,
          flag: 'pick-printing',
          via: 'art',
          game: 'pkm'
        })
      ])
    )
    const store = fakeStore()
    renderWithProviders(
      <PhoneContext.Provider value={{ store, user: SETO, signedOut: () => {} }}>
        <GameProvider>
          <ScanHubProvider>
            <ScannerScreen
              engineFactory={() => fakeEngine()}
              onClose={() => {}}
              onOpenSettings={() => {}}
            />
          </ScanHubProvider>
        </GameProvider>
      </PhoneContext.Provider>,
      { api: createMockApi({ scanWindow: fakeBridge().scanWindow, games: pkmGames }) }
    )
    await settle()
    const last = screen.getByRole('region', { name: 'Last scan' })
    expect(within(last).getByText('Check version')).toBeInTheDocument()
    expect(within(last).queryByLabelText('Price of Pikachu')).not.toBeInTheDocument()
    expect(within(last).queryByText('Normal')).not.toBeInTheDocument()
    expect(within(last).getByLabelText('Price range of Pikachu')).toHaveTextContent('$1.00 – $3.50')
    expect(screen.queryByRole('button', { name: /New scans as/ })).not.toBeInTheDocument()
  })
})
