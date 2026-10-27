import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { PackOpener } from '@/features/rip/PackOpener'
import type { Api } from '@shared/ipc'
import type { RipCard } from '../../src/shared/rip/types'
import type { CardDetail, CardRow } from '../../src/shared/types'
import { createMockApi, renderWithProviders } from './mockApi'

// jsdom never loads images: the art is "in" at once.
import { loadArt } from '@/features/rip/loadArt'

vi.mock('@/features/rip/loadArt', () => ({ loadArt: vi.fn(async () => undefined) }))

const card = (rarity: string, slot: number, name = `Card ${slot}`): RipCard => ({
  pkey: `k${slot}`,
  cardId: slot,
  name,
  setCode: `LOB-EN00${slot}`,
  rarity,
  variant: null,
  frameType: 'normal',
  imageId: slot,
  slot
})

const commons = (): RipCard[] => [card('Common', 0), card('Common', 1), card('Common', 2)]
/** A 9-card pack whose hit sits in the middle slot; the opener puts it last. */
const nine = (): RipCard[] =>
  Array.from({ length: 9 }, (_, i) =>
    i === 4 ? card('Secret Rare', 4, 'Dark Magician') : card('Common', i)
  )

const row = (id: number, over: Partial<CardRow>): CardRow => ({
  id,
  name: `Card ${id}`,
  type: 'Effect Monster',
  frameType: 'effect',
  race: 'Spellcaster',
  attribute: 'DARK',
  level: 4,
  linkval: null,
  atk: 1500,
  def: 1200,
  archetype: null,
  desc: 'Some effect.',
  tcgplayerPrice: null,
  ...over
})
/** Each card's details: a Fusion, a Quick-Play, a Link and an Xyz, by card id. */
const ROWS: Record<number, CardRow> = {
  0: row(0, {
    type: 'Fusion Monster',
    frameType: 'fusion',
    race: 'Dragon',
    attribute: 'LIGHT',
    level: 12,
    atk: 4500,
    def: 3800,
    desc: '"Blue-Eyes White Dragon" + "Blue-Eyes White Dragon" + "Blue-Eyes White Dragon"\nThis card is a beast.'
  }),
  1: row(1, {
    type: 'Spell Card',
    frameType: 'spell',
    race: 'Quick-Play',
    attribute: null,
    level: null,
    atk: null,
    def: null,
    desc: 'Destroy 1 card.'
  }),
  2: row(2, {
    type: 'Link Monster',
    frameType: 'link',
    race: 'Cyberse',
    attribute: 'EARTH',
    level: null,
    linkval: 3,
    atk: 2300,
    def: null,
    desc: '2+ Effect Monsters\nLink effect.'
  }),
  3: row(3, {
    type: 'XYZ Monster',
    frameType: 'xyz',
    race: 'Warrior',
    attribute: 'FIRE',
    level: 4,
    atk: -1,
    def: 2000,
    desc: '2 Level 4 monsters\nXyz effect.'
  })
}
const cardsGet = async (id: number): Promise<CardDetail | null> =>
  ROWS[id] ? { card: ROWS[id], printings: [], images: [] } : null
const four = (): RipCard[] => [0, 1, 2, 3].map((i) => card('Common', i))
const info = (): HTMLElement => screen.getByTestId('rip-info')

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const space = (target: Window | Element = window): void => {
  fireEvent.keyDown(target, { key: ' ', code: 'Space' })
}

/** Most tests run with reduced motion: no slides or tears, so every step is immediate. */
const realMatchMedia = window.matchMedia
function motion(reduce: boolean): void {
  const real = realMatchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    ...real(q),
    matches: reduce && q.includes('reduce')
  }))
}

function renderOpener(
  openPack: (id: number) => Promise<RipCard[]>,
  {
    packCount = 3,
    onDone = vi.fn<(packs: RipCard[][]) => void>(),
    strict = false,
    active = true,
    cardsGet
  }: {
    packCount?: number
    onDone?: ReturnType<typeof vi.fn<(packs: RipCard[][]) => void>>
    strict?: boolean
    active?: boolean
    cardsGet?: Api['cards']['get']
  } = {}
): { api: Api; unmount: () => void; onDone: typeof onDone } {
  const ui = (
    <PackOpener
      sessionId={7}
      packCount={packCount}
      setName="Legend of Blue Eyes"
      onDone={onDone}
      active={active}
    />
  )
  const api = createMockApi({
    rip: { openPack: vi.fn(openPack) },
    ...(cardsGet && { cards: { get: vi.fn(cardsGet) } })
  })
  if (strict) {
    // StrictMode at the root: React only double-runs mount effects for a root-level StrictMode.
    window.api = api
    return {
      api,
      unmount: render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>, {
        reactStrictMode: true
      }).unmount,
      onDone
    }
  }
  return { ...renderWithProviders(ui, { api }), onDone }
}

const skipButton = (): HTMLElement => screen.getByRole('button', { name: /skip to the hit/i })
const nextButton = (): HTMLElement => screen.getByRole('button', { name: /finish|next pack/i })
const loadedPack = async (): Promise<void> => {
  await waitFor(() => expect(skipButton()).toBeEnabled())
}
const front = (): HTMLElement => screen.getByTestId('rip-front')
const count = (): string => screen.getByTestId('rip-count').textContent ?? ''

describe('PackOpener', () => {
  beforeEach(() => motion(true))
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('after a pack refreshes History and sessions, not the sets list, and loads the art first', async () => {
    vi.mocked(loadArt).mockClear()
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderOpener(async () => nine())
    await loadedPack()
    const keys = spy.mock.calls.map(([f]) => f?.queryKey)
    expect(keys).toEqual([
      ['rip', 'history'],
      ['rip', 'session']
    ])
    // Ahead of other downloads (?now): the first three before the pack opens, then the rest.
    const calls = vi.mocked(loadArt).mock.calls
    expect(calls[0][0]).toEqual([
      'ygo-img://full/0?now',
      'ygo-img://full/1?now',
      'ygo-img://full/2?now'
    ])
    expect(calls[1][0]).toHaveLength(6)
  })

  it("the pack stays shut until its first cards' art is in", async () => {
    const art = deferred<undefined>()
    vi.mocked(loadArt).mockImplementationOnce(() => art.promise)
    renderOpener(async () => commons())
    await act(async () => {})
    // Torn early: the tear plays, and the cards wait for their art.
    space()
    expect(skipButton()).toBeDisabled()
    expect(screen.queryByTestId('rip-front')).not.toBeInTheDocument()
    await act(async () => art.resolve(undefined))
    await waitFor(() => expect(screen.getByTestId('rip-front')).toBeInTheDocument())
  })

  it('opens the first pack once under StrictMode', async () => {
    const { api } = renderOpener(async () => commons(), { strict: true })
    await loadedPack()
    expect(api.rip.openPack).toHaveBeenCalledTimes(1)
    expect(api.rip.openPack).toHaveBeenCalledWith(7)
    expect(screen.getByText(/pack 1 of 3/i)).toBeInTheDocument()
  })

  it('shows the sealed pack first; Space tears it and the first card is the front', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    expect(screen.getByTestId('rip-pack')).toHaveTextContent(/click to tear open/i)
    expect(screen.queryByTestId('rip-front')).not.toBeInTheDocument()
    space()
    expect(screen.queryByTestId('rip-pack')).not.toBeInTheDocument()
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Card 0' }))
    expect(count()).toBe('1 / 9')
    expect(screen.getByTestId('rip-info')).toHaveTextContent('Card 0')
    expect(screen.getByTestId('rip-info')).toHaveTextContent('LOB-EN000')
  })

  it('clicking the pack tears it, with the strip flying off first', async () => {
    motion(false)
    vi.useFakeTimers()
    renderOpener(async () => nine())
    await act(() => vi.advanceTimersByTimeAsync(0))
    fireEvent.click(screen.getByTestId('rip-pack'))
    expect(screen.getByTestId('rip-pack')).toHaveAttribute('data-phase', 'tearing')
    expect(screen.queryByTestId('rip-front')).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(550))
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Card 0' }))
    expect(count()).toBe('1 / 9')
  })

  it('a pack torn before it loads opens when the cards arrive', async () => {
    const pack = deferred<RipCard[]>()
    renderOpener(() => pack.promise)
    expect(skipButton()).toBeDisabled()
    space()
    expect(screen.getByTestId('rip-pack')).toHaveAttribute('data-phase', 'tearing')
    await act(async () => pack.resolve(commons()))
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Card 0' }))
    expect(count()).toBe('1 / 3')
  })

  it('each move brings the next card to the front', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    for (let i = 1; i < 9; i++) {
      space()
      expect(count()).toBe(`${i + 1} / 9`)
    }
    // The hit was in slot 4; it comes last.
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Dark Magician' }))
    expect(screen.getByText(/That's the pack\./)).toBeInTheDocument()
  })

  it('a swipe on the front card sends it on; a short drag springs back', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    const drag = (dx: number): void => {
      const el = front()
      fireEvent.pointerDown(el, { clientX: 100, pointerId: 1 })
      fireEvent.pointerMove(el, { clientX: 100 + dx / 2, pointerId: 1 })
      fireEvent.pointerMove(el, { clientX: 100 + dx, pointerId: 1 })
      // The card follows the pointer.
      expect(el.style.transform).toContain(`translateX(${dx}px)`)
      fireEvent.pointerUp(el, { clientX: 100 + dx, pointerId: 1 })
      fireEvent.click(el)
    }
    drag(30)
    expect(count()).toBe('1 / 9')
    expect(front().style.transform).not.toContain('translateX')
    drag(90)
    expect(count()).toBe('2 / 9')
    drag(-90)
    expect(count()).toBe('3 / 9')
    // A plain click still sends it back.
    fireEvent.pointerDown(front(), { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(front(), { clientX: 100, pointerId: 1 })
    fireEvent.click(front())
    expect(count()).toBe('4 / 9')
  })

  it('Skip to the hit sends the cards on one by one and stops on the hit', async () => {
    motion(false)
    vi.useFakeTimers()
    renderOpener(async () => nine())
    await act(() => vi.advanceTimersByTimeAsync(0))
    fireEvent.click(skipButton())
    expect(skipButton()).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(550))
    expect(count()).toBe('1 / 9')
    await act(() => vi.advanceTimersByTimeAsync(330))
    expect(count()).toBe('2 / 9')
    // One act per step: React runs each step's effect (which queues the next) when act ends.
    for (let i = 0; i < 7; i++) await act(() => vi.advanceTimersByTimeAsync(330))
    expect(count()).toBe('9 / 9')
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Dark Magician' }))
    expect(skipButton()).toBeDisabled()
    // The hit still holds the moment (420ms settle + 1500ms) before Next pack is offered.
    expect(nextButton()).toBeDisabled()
    for (let i = 0; i < 2; i++) await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(nextButton()).toBeEnabled()
    expect(count()).toBe('9 / 9')
  })

  it('ignores Space, clicks and drags while skipping', async () => {
    motion(false)
    vi.useFakeTimers()
    renderOpener(async () => nine())
    await act(() => vi.advanceTimersByTimeAsync(0))
    space()
    await act(() => vi.advanceTimersByTimeAsync(550))
    fireEvent.click(skipButton())
    expect(count()).toBe('2 / 9')
    space()
    fireEvent.click(front())
    const el = front()
    fireEvent.pointerDown(el, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 200, pointerId: 1 })
    expect(el.style.transform).not.toContain('translateX')
    fireEvent.pointerUp(el, { clientX: 200, pointerId: 1 })
    expect(count()).toBe('2 / 9')
    await act(() => vi.advanceTimersByTimeAsync(330))
    expect(count()).toBe('3 / 9')
  })

  it('Next pack waits out the hit, then clicking the hit moves on', async () => {
    motion(false)
    vi.useFakeTimers()
    renderOpener(async () => [card('Common', 1), card('Ultra Rare', 0, 'Blue-Eyes')])
    await act(() => vi.advanceTimersByTimeAsync(0))
    space()
    await act(() => vi.advanceTimersByTimeAsync(550))
    space()
    expect(count()).toBe('2 / 2')
    // Focused, the enabled-looking button would take Space; it stays disabled through the hold.
    expect(nextButton()).toBeDisabled()
    fireEvent.click(nextButton())
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(nextButton()).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(nextButton()).toBeEnabled()
    expect(screen.getByText(/click for the next one/i)).toBeInTheDocument()
    fireEvent.click(front())
    expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument()
  })

  it('a quick double-click onto the last card does not skip past it', async () => {
    vi.useFakeTimers()
    renderOpener(async () => [card('Common', 1), card('Common', 0, 'Last')])
    await act(() => vi.advanceTimersByTimeAsync(0))
    space()
    fireEvent.click(screen.getByTestId('rip-stage'))
    expect(count()).toBe('2 / 2')
    fireEvent.click(screen.getByTestId('rip-stage'))
    expect(screen.getByText(/pack 1 of 3/i)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(500))
    fireEvent.click(screen.getByTestId('rip-stage'))
    expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument()
  })

  it('clicking the last card of the last pack finishes', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn<(packs: RipCard[][]) => void>()
    renderOpener(async () => [card('Common', 0)], { packCount: 1, onDone })
    await act(() => vi.advanceTimersByTimeAsync(0))
    space()
    expect(screen.getByText(/click for your summary/i)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(500))
    fireEvent.click(screen.getByTestId('rip-stage'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('a sent card goes down to the row, in the order seen', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    expect(screen.queryAllByTestId('rip-row-card')).toHaveLength(0)
    space()
    space()
    const row = screen.getByRole('list', { name: /seen cards/i })
    expect(
      within(row)
        .getAllByRole('img')
        .map((img) => img.getAttribute('alt'))
    ).toEqual(['Card 0', 'Card 1'])
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Card 2' }))
    // The row is small, full-brightness art with no holo.
    for (const el of within(row).getAllByTestId('rip-row-card')) {
      expect(el.querySelector('[data-holo]')).toBeNull()
      expect(el.querySelector<HTMLElement>('[style*="brightness"]')).toBeNull()
    }
  })

  it('at the end the hit stays at the front and every other card is in the row', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    for (let i = 0; i < 9; i++) space()
    expect(count()).toBe('9 / 9')
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Dark Magician' }))
    const row = screen.getByRole('list', { name: /seen cards/i })
    expect(
      within(row)
        .getAllByRole('img')
        .map((img) => img.getAttribute('alt'))
    ).toEqual(['Card 0', 'Card 1', 'Card 2', 'Card 3', 'Card 5', 'Card 6', 'Card 7', 'Card 8'])
    expect(within(row).queryByRole('img', { name: 'Dark Magician' })).not.toBeInTheDocument()
    // Space at the end is the next pack, sealed; torn, it starts with an empty row.
    space()
    await loadedPack()
    space()
    expect(count()).toBe('1 / 9')
    expect(screen.queryAllByTestId('rip-row-card')).toHaveLength(0)
  })

  it('keeps the hand to the front card and up to four edges, dimmed behind it', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    space()
    const hand = [...document.querySelectorAll<HTMLElement>('[data-hand-card]')]
    expect(hand.map((el) => el.dataset.handCard)).toEqual(['0', '1', '2', '3', '4'])
    expect(hand[0].style.filter).toBe('')
    for (const el of hand.slice(1)) expect(el.style.filter).toContain('brightness(')
    // Only the front and the row are cards to look at; the edges are decoration.
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual([
      'Card 1',
      'Card 0'
    ])
    space()
    space()
    space()
    space()
    // Five left: the hit and the four before it.
    expect(document.querySelectorAll('[data-hand-card]')).toHaveLength(4)
  })

  it('quick moves each land in the row', async () => {
    motion(false)
    vi.useFakeTimers()
    renderOpener(async () => nine())
    await act(() => vi.advanceTimersByTimeAsync(0))
    space()
    await act(() => vi.advanceTimersByTimeAsync(550))
    space()
    expect(screen.getByTestId('rip-info-out')).toHaveTextContent('Card 0')
    await act(() => vi.advanceTimersByTimeAsync(100))
    space()
    expect(count()).toBe('3 / 9')
    expect(screen.getAllByTestId('rip-row-card')).toHaveLength(2)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.queryByTestId('rip-info-out')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('rip-row-card')).toHaveLength(2)
  })

  it("the pack is the set's pack photo when it has one, torn from the same picture", async () => {
    renderWithProviders(
      <PackOpener
        sessionId={7}
        packCount={1}
        setName="Beyond the Brave"
        onDone={vi.fn()}
        packArt={{
          setCode: 'BTB',
          packImageKey: 'BTB-pack.png',
          logoImageKey: 'BTB-logo.png',
          coverImageId: 12
        }}
      />,
      { api: createMockApi({ rip: { openPack: vi.fn(async () => commons()) } }) }
    )
    const pack = screen.getByTestId('rip-pack')
    const photos = pack.querySelectorAll('[data-testid="rip-pack-image"]')
    // Once for the body, once for the strip.
    expect(photos).toHaveLength(2)
    for (const img of photos) expect(img).toHaveAttribute('src', 'ygo-img://set/BTB-pack.png?now')
    expect(within(screen.getByTestId('rip-pack-strip')).getByTestId('rip-pack-image')).toBeTruthy()
    expect(pack.querySelector('[data-testid="rip-pack-wrapper"]')).toBeNull()
    // The pack is the photo: no foil behind it, no crimps of ours, only the tear line cut.
    expect(pack.querySelector('[data-testid="rip-pack-crimp"]')).toBeNull()
    for (const face of pack.querySelectorAll<HTMLElement>('[data-testid="rip-pack-face"]')) {
      expect(face.style.backgroundImage).toBe('')
    }
    expect(screen.getByTestId('rip-pack-strip').style.clipPath).toMatch(/^polygon\(0% 0%, 100% 0%/)
    // The sheen is masked to the photo, so it only crosses the pack.
    for (const sheen of pack.querySelectorAll<HTMLElement>('[data-testid="rip-pack-sheen"]')) {
      expect(sheen.getAttribute('style')).toContain(
        'mask-image: url("ygo-img://set/BTB-pack.png?now")'
      )
    }
    // The box is cropped to the pack in the photo's square canvas.
    expect(screen.getByTestId('rip-pack-box').style.width).toContain('0.6')
    // A broken photo falls back to the wrapper, crimps and all.
    fireEvent.error(photos[0])
    expect(pack.querySelector('[data-testid="rip-pack-image"]')).toBeNull()
    expect(pack.querySelector('[data-testid="rip-pack-wrapper"]')).not.toBeNull()
    expect(pack.querySelectorAll('[data-testid="rip-pack-crimp"]').length).toBeGreaterThan(0)
    expect(screen.getByTestId('rip-pack-box').style.width).toContain('0.64')
  })

  it('without a pack photo the pack is a foil wrapper with the cover art and logo', async () => {
    renderWithProviders(
      <PackOpener
        sessionId={7}
        packCount={1}
        setName="Phantom Nightmare"
        onDone={vi.fn()}
        packArt={{
          setCode: 'PHNI',
          packImageKey: null,
          logoImageKey: 'PHNI-logo.png',
          coverImageId: 12
        }}
      />,
      { api: createMockApi({ rip: { openPack: vi.fn(async () => commons()) } }) }
    )
    const body = screen
      .getByTestId('rip-pack')
      .querySelector<HTMLElement>('[data-testid="rip-pack-wrapper"]')!
    expect(body.querySelector('img[src="ygo-img://cropped/12"]')).not.toBeNull()
    expect(within(body).getByTestId('rip-pack-logo')).toHaveAttribute(
      'src',
      'ygo-img://set/PHNI-logo.png?now'
    )
    expect(body).toHaveTextContent('PHNI')
    // The set name only stands in when there's no logo.
    expect(body).not.toHaveTextContent('Phantom Nightmare')
    expect(screen.getByTestId('rip-pack')).toHaveTextContent(/click to tear open/i)
  })

  it('without a logo the wrapper shows the set name', async () => {
    renderOpener(async () => commons())
    expect(screen.getAllByTestId('rip-pack-wrapper')[0]).toHaveTextContent('Legend of Blue Eyes')
  })

  it('the card and pack size from the stage height', async () => {
    renderOpener(async () => commons())
    await loadedPack()
    expect(screen.getByTestId('rip-middle').style.containerType).toBe('size')
    // The pack is as tall as the card will be.
    expect(screen.getByTestId('rip-pack-box').style.height).toContain('100cqh')
    space()
    const handBox = front().parentElement!
    expect(handBox.style.height).toContain('100cqh')
    // Capped, and kept narrow enough to leave the gap, the narrowest panel and margins beside it.
    expect(handBox.style.height).toContain('600px')
    expect(handBox.style.height).toContain('100cqw')
    expect(handBox.style.height).toContain('388px')
    // Placed from the stage height too. (jsdom mangles min()/max() inside calc(), so the 32px floor
    // can't be read back here; checked in Chrome instead.)
    expect(handBox.style.top).toContain('100cqh')
  })

  it('a sent card flies down from the front into its place in the row', async () => {
    motion(false)
    vi.useFakeTimers()
    const animate = vi.fn()
    Element.prototype.animate = animate as unknown as Element['animate']
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const front = this.getAttribute('data-testid') === 'rip-front'
      return {
        left: front ? 400 : 20,
        top: front ? 60 : 520,
        width: front ? 280 : 60,
        height: front ? 408 : 87,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
    })
    try {
      renderOpener(async () => nine())
      await act(() => vi.advanceTimersByTimeAsync(0))
      space()
      await act(() => vi.advanceTimersByTimeAsync(550))
      space()
      expect(animate).toHaveBeenCalledTimes(1)
      const [frames, options] = animate.mock.calls[0]
      expect(frames).toEqual([
        { transform: `translate(380px, -460px) scale(${280 / 60})` },
        { transform: 'none' }
      ])
      expect(options).toMatchObject({ duration: 420 })
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate
    }
  })

  it('clicking a seen card in the row leaves the hand where it is', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    space()
    space()
    expect(count()).toBe('3 / 9')
    fireEvent.click(screen.getAllByTestId('rip-row-card')[0])
    fireEvent.click(screen.getByTestId('rip-bottom'))
    expect(count()).toBe('3 / 9')
  })

  it('with reduced motion the hand swaps without transitions', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    space()
    for (const el of document.querySelectorAll<HTMLElement>('[data-hand-card]')) {
      expect(el.style.transition).toBe('none')
    }
  })

  it('edges show no holo, so a Starlight at the back stays a surprise', async () => {
    renderOpener(async () => [
      card('Common', 0),
      card('Common', 1),
      card('Starlight Rare', 2, 'Starlight')
    ])
    await loadedPack()
    space()
    expect(document.querySelectorAll('[data-hand-card]')).toHaveLength(3)
    expect(document.querySelector('[data-holo]')).toBeNull()
    space()
    space()
    expect(front().querySelector('[data-holo]')).not.toBeNull()
    expect(document.querySelectorAll('[data-holo]')).toHaveLength(1)
  })

  it('Space mid-drag leaves the new front card centred', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    const el = front()
    fireEvent.pointerDown(el, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 140, pointerId: 1 })
    space()
    expect(count()).toBe('2 / 9')
    expect(front().style.transform).not.toContain('translateX')
  })

  it('a right-button drag does nothing', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    const el = front()
    fireEvent.pointerDown(el, { clientX: 100, pointerId: 1, button: 2 })
    fireEvent.pointerMove(el, { clientX: 200, pointerId: 1, button: 2 })
    expect(el.style.transform).not.toContain('translateX')
  })

  it('Skip to the hit is instant with reduced motion', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    fireEvent.click(skipButton())
    expect(count()).toBe('9 / 9')
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Dark Magician' }))
    expect(skipButton()).toBeDisabled()
  })

  it('a hit blooms, holds and shows its rarity, and the best pull so far', async () => {
    motion(false)
    vi.useFakeTimers()
    renderOpener(async () => [card('Secret Rare', 0, 'Dark Magician'), card('Common', 1)])
    await act(() => vi.advanceTimersByTimeAsync(0))
    space()
    await act(() => vi.advanceTimersByTimeAsync(550))
    expect(screen.queryByTestId('rip-bloom')).not.toBeInTheDocument()
    expect(screen.getByTestId('rip-best')).toHaveTextContent('Common')
    space()
    expect(front()).toHaveAttribute('data-tier', 'huge')
    expect(front().querySelector('[data-holo]')).not.toBeNull()
    expect(screen.getByTestId('rip-bloom')).toBeInTheDocument()
    expect(screen.getAllByText('✦')).toHaveLength(10)
    expect(screen.getByTestId('rip-info')).toHaveTextContent('Dark Magician')
    expect(screen.getByTestId('rip-info')).toHaveTextContent('Secret Rare')
    expect(screen.getByTestId('rip-best')).toHaveTextContent('Secret Rare')
    expect(document.body.textContent).not.toMatch(/\$\d/)
    // The hit holds the moment: Space doesn't move on until it's had its time.
    await act(() => vi.advanceTimersByTimeAsync(1000))
    space()
    expect(screen.getByText(/pack 1 of 3/i)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    space()
    expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument()
  })

  it('the next pack waits sealed for its tear; torn early, its cards come out as they load', async () => {
    const second = deferred<RipCard[]>()
    const calls = [Promise.resolve(commons()), second.promise]
    const { api } = renderOpener(() => calls.shift() ?? new Promise(() => {}))
    await loadedPack()
    fireEvent.click(skipButton())
    fireEvent.click(nextButton())
    expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument()
    expect(screen.getByTestId('rip-pack')).toBeInTheDocument()
    expect(screen.queryByTestId('rip-front')).not.toBeInTheDocument()
    space()
    expect(screen.queryByTestId('rip-front')).not.toBeInTheDocument()
    await act(async () => second.resolve([card('Rare', 5, 'Next One'), card('Common', 6)]))
    await waitFor(() => expect(screen.queryByTestId('rip-pack')).not.toBeInTheDocument())
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Card 6' }))
    expect(count()).toBe('1 / 2')
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
  })

  it('under StrictMode the next pack opens once and waits sealed until torn', async () => {
    motion(false)
    vi.useFakeTimers()
    const { api } = renderOpener(async () => [card('Common', 0), card('Common', 1)], {
      strict: true
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    space()
    await act(() => vi.advanceTimersByTimeAsync(550))
    space()
    await act(() => vi.advanceTimersByTimeAsync(800))
    fireEvent.click(nextButton())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByTestId('rip-pack')).toHaveAttribute('data-phase', 'sealed')
    fireEvent.click(screen.getByTestId('rip-stage'))
    expect(screen.getByTestId('rip-pack')).toHaveAttribute('data-phase', 'tearing')
    await act(() => vi.advanceTimersByTimeAsync(550))
    expect(count()).toBe('1 / 2')
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(count()).toBe('1 / 2')
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
  })

  it('unmounting on the sealed next pack is quiet', async () => {
    motion(false)
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error')
    const { unmount } = renderOpener(async () => commons())
    await act(() => vi.advanceTimersByTimeAsync(0))
    fireEvent.click(skipButton())
    for (let i = 0; i < 4; i++) await act(() => vi.advanceTimersByTimeAsync(330))
    fireEvent.click(nextButton())
    await act(() => vi.advanceTimersByTimeAsync(0))
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(error).not.toHaveBeenCalled()
  })

  it('while hidden, the next pack waits sealed and a skip pauses', async () => {
    const calls = [Promise.resolve(commons()), Promise.resolve(commons())]
    const onDone = vi.fn()
    const api = createMockApi({ rip: { openPack: vi.fn(() => calls.shift()!) } })
    const ui = (active: boolean): React.JSX.Element => (
      <PackOpener
        sessionId={7}
        packCount={3}
        setName="Legend of Blue Eyes"
        onDone={onDone}
        active={active}
      />
    )
    const { rerender } = renderWithProviders(ui(true), { api })
    await loadedPack()
    fireEvent.click(skipButton())
    fireEvent.click(nextButton())
    rerender(ui(false))
    await waitFor(() => expect(skipButton()).toBeEnabled())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByTestId('rip-pack')).toHaveAttribute('data-phase', 'sealed')
    rerender(ui(true))
    space()
    await waitFor(() => expect(count()).toBe('1 / 3'))

    // Animated skip, then hidden: it stops where it is until shown again.
    motion(false)
    rerender(ui(true)) // the opener reads the motion setting as it renders
    fireEvent.click(skipButton())
    expect(count()).toBe('2 / 3')
    rerender(ui(false))
    await new Promise((r) => setTimeout(r, 450))
    expect(count()).toBe('2 / 3')
    rerender(ui(true))
    await waitFor(() => expect(count()).toBe('3 / 3'))
  })

  it('next pack only once while loading', async () => {
    const second = deferred<RipCard[]>()
    const calls = [Promise.resolve(commons()), second.promise]
    const { api } = renderOpener(() => calls.shift() ?? new Promise(() => {}))
    await loadedPack()
    fireEvent.click(skipButton())
    for (let i = 0; i < 5; i++) space()
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    await act(async () => second.resolve(commons()))
    await waitFor(() => expect(screen.getByTestId('rip-front')).toBeInTheDocument())
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument()
  })

  it('Space on a focused button is left to the button', async () => {
    renderOpener(async () => commons())
    await loadedPack()
    expect(fireEvent.keyDown(skipButton(), { key: ' ', code: 'Space' })).toBe(true)
    expect(screen.getByTestId('rip-pack')).toBeInTheDocument()
    expect(screen.queryByTestId('rip-front')).not.toBeInTheDocument()
  })

  it('Space on a disabled button still moves on', async () => {
    const { api } = renderOpener(async () => commons())
    await loadedPack()
    fireEvent.click(skipButton())
    expect(skipButton()).toBeDisabled()
    space(skipButton())
    await waitFor(() => expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument())
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    // On the disabled Next pack, Space tears the second pack, then sends a card down.
    await loadedPack()
    const next = nextButton()
    expect(next).toBeDisabled()
    space(next)
    await waitFor(() => expect(count()).toBe('1 / 3'))
    space(next)
    expect(count()).toBe('2 / 3')
  })

  it('ignores Space while inactive', async () => {
    renderOpener(async () => commons(), { active: false })
    await loadedPack()
    space()
    expect(screen.getByTestId('rip-pack')).toBeInTheDocument()
    expect(screen.queryByTestId('rip-front')).not.toBeInTheDocument()
  })

  it('reports every opened pack once, when the last pack is done', async () => {
    const { onDone } = renderOpener(async () => commons(), { packCount: 2 })
    await loadedPack()
    fireEvent.click(skipButton())
    fireEvent.click(nextButton())
    await loadedPack()
    space()
    await waitFor(() => expect(count()).toBe('1 / 3'))
    fireEvent.click(skipButton())
    expect(nextButton()).toHaveTextContent('Finish')
    fireEvent.click(nextButton())
    space()
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(onDone.mock.calls[0][0]).toHaveLength(2)
    expect(onDone.mock.calls[0][0][1]).toHaveLength(3)
  })

  it('shows a retry when opening a pack fails', async () => {
    const calls = [Promise.reject(new Error('boom')), Promise.resolve(commons())]
    const { api } = renderOpener(() => calls.shift()!)
    const retry = await screen.findByRole('button', { name: /try again/i })
    expect(skipButton()).toBeDisabled()
    fireEvent.click(retry)
    await loadedPack()
    expect(screen.getByTestId('rip-pack')).toBeInTheDocument()
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
  })

  it('unmount mid-session keeps opened packs', async () => {
    const error = vi.spyOn(console, 'error')
    const second = deferred<RipCard[]>()
    const calls = [Promise.resolve(commons()), second.promise]
    const { api, unmount } = renderOpener(() => calls.shift() ?? Promise.resolve(commons()))
    await loadedPack()
    fireEvent.click(skipButton())
    space()
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => second.resolve(commons()))
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
  })
  describe('the info panel', () => {
    it("fetches every card's details as the pack arrives", async () => {
      const { api } = renderOpener(async () => four(), { cardsGet })
      await loadedPack()
      await waitFor(() => expect(api.cards.get).toHaveBeenCalledTimes(4))
      expect(vi.mocked(api.cards.get).mock.calls.map(([id]) => id)).toEqual([0, 1, 2, 3])
    })

    it("shows a monster's attribute, type, level, ATK/DEF and text, materials apart", async () => {
      renderOpener(async () => four(), { cardsGet })
      await loadedPack()
      space()
      await waitFor(() => expect(within(info()).getByTestId('rip-type-line')).toBeInTheDocument())
      expect(info()).toHaveTextContent('Card 0')
      expect(info()).toHaveTextContent('LOB-EN000')
      expect(within(info()).getByTestId('rip-attribute')).toHaveTextContent('LIGHT')
      expect(within(info()).getByTestId('rip-type-line')).toHaveTextContent('Dragon / Fusion')
      expect(within(info()).getByTestId('rip-type-line')).toHaveTextContent('★ Level 12')
      expect(
        within(info())
          .getAllByTestId('rip-stat')
          .map((s) => s.textContent)
      ).toEqual(['ATK4500', 'DEF3800'])
      expect(within(info()).getByTestId('rip-materials')).toHaveTextContent(
        '"Blue-Eyes White Dragon" + "Blue-Eyes White Dragon" + "Blue-Eyes White Dragon"'
      )
      expect(within(info()).getByTestId('rip-desc')).toHaveTextContent('This card is a beast.')
    })

    it('updates as the front card changes: a spell has its type line and no stats', async () => {
      renderOpener(async () => four(), { cardsGet })
      await loadedPack()
      space()
      await waitFor(() => expect(info()).toHaveTextContent('Dragon / Fusion'))
      space()
      await waitFor(() => expect(info()).toHaveTextContent('Spell Card · Quick-Play'))
      expect(info()).toHaveTextContent('Card 1')
      expect(info()).not.toHaveTextContent('Dragon')
      expect(within(info()).queryByTestId('rip-stat')).not.toBeInTheDocument()
      expect(within(info()).queryByTestId('rip-attribute')).not.toBeInTheDocument()
      expect(within(info()).getByTestId('rip-desc')).toHaveTextContent('Destroy 1 card.')
    })

    it('a Link shows LINK-N and no DEF; an Xyz shows its Rank and ? for an unknown ATK', async () => {
      renderOpener(async () => four(), { cardsGet })
      await loadedPack()
      space()
      space()
      space()
      await waitFor(() => expect(info()).toHaveTextContent('Cyberse / Link'))
      expect(info()).toHaveTextContent('Link 3')
      expect(
        within(info())
          .getAllByTestId('rip-stat')
          .map((s) => s.textContent)
      ).toEqual(['ATK2300', 'LINK3'])
      expect(info()).not.toHaveTextContent('DEF')
      space()
      await waitFor(() => expect(info()).toHaveTextContent('Warrior / Xyz'))
      expect(info()).toHaveTextContent('Rank 4')
      expect(within(info()).getByTestId('rip-type-line')).not.toHaveTextContent('Level')
      expect(
        within(info())
          .getAllByTestId('rip-stat')
          .map((s) => s.textContent)
      ).toEqual(['ATK?', 'DEF2000'])
    })

    it('shows the name and a quiet placeholder while the details load', async () => {
      const details = deferred<CardDetail | null>()
      renderOpener(async () => four(), { cardsGet: () => details.promise })
      await loadedPack()
      space()
      expect(info()).toHaveTextContent('Card 0')
      expect(within(info()).getByTestId('rip-info-loading')).toBeInTheDocument()
      await act(async () => details.resolve({ card: ROWS[0], printings: [], images: [] }))
      await waitFor(() => expect(info()).toHaveTextContent('Dragon / Fusion'))
      expect(within(info()).queryByTestId('rip-info-loading')).not.toBeInTheDocument()
    })

    it('clicking or dragging in the panel does not move the hand on', async () => {
      renderOpener(async () => four(), { cardsGet })
      await loadedPack()
      space()
      await waitFor(() => expect(within(info()).getByTestId('rip-desc')).toBeInTheDocument())
      fireEvent.click(info())
      fireEvent.click(within(info()).getByTestId('rip-desc'))
      const desc = within(info()).getByTestId('rip-desc')
      fireEvent.pointerDown(desc, { clientX: 0, pointerId: 1, button: 0 })
      fireEvent.pointerMove(desc, { clientX: 200, pointerId: 1, button: 0 })
      fireEvent.pointerUp(desc, { clientX: 200, pointerId: 1, button: 0 })
      fireEvent.click(desc)
      expect(count()).toBe('1 / 4')
      expect(info()).toHaveTextContent('Card 0')
    })
  })
})
