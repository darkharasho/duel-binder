import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { PackOpener } from '@/features/rip/PackOpener'
import type { Api } from '@shared/ipc'
import type { RipCard } from '../../src/shared/rip/types'
import { createMockApi, renderWithProviders } from './mockApi'

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
  { packCount = 3, onDone = vi.fn(), strict = false, active = true } = {}
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
  const api = createMockApi({ rip: { openPack: vi.fn(openPack) } })
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

  it('after a pack refreshes History and sessions, not the sets list, and preloads the art', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const srcs: string[] = []
    const RealImage = window.Image
    vi.stubGlobal(
      'Image',
      class {
        set src(v: string) {
          srcs.push(v)
        }
      }
    )
    try {
      renderOpener(async () => commons())
      await loadedPack()
      const keys = spy.mock.calls.map(([f]) => f?.queryKey)
      expect(keys).toEqual([
        ['rip', 'history'],
        ['rip', 'session']
      ])
      expect(srcs).toEqual(['ygo-img://full/0', 'ygo-img://full/1', 'ygo-img://full/2'])
    } finally {
      vi.stubGlobal('Image', RealImage)
    }
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
    expect(screen.getByTestId('rip-caption')).toHaveTextContent('Card 0')
    expect(screen.getByTestId('rip-caption')).toHaveTextContent('LOB-EN000')
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

  it('each move to the back brings the next card to the front', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    for (let i = 1; i < 9; i++) {
      space()
      expect(count()).toBe(`${i + 1} / 9`)
    }
    // The hit was in slot 4; it comes last.
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Dark Magician' }))
    expect(screen.getByText("That's the pack.")).toBeInTheDocument()
  })

  it('the front card slides off and the stack moves up', async () => {
    motion(false)
    vi.useFakeTimers()
    renderOpener(async () => nine())
    await act(() => vi.advanceTimersByTimeAsync(0))
    space()
    await act(() => vi.advanceTimersByTimeAsync(550))
    space()
    expect(count()).toBe('2 / 9')
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Card 1' }))
    // Card 0 is on its way out, off to the right and above everything.
    const out = document.querySelector<HTMLElement>('[data-leaving="out"]')!
    expect(out.style.transform).toContain('translate(380px, -30px)')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(document.querySelector('[data-leaving="out"]')).toBeNull()
    expect(document.querySelector<HTMLElement>('[data-leaving="tuck"]')!.style.zIndex).toBe('0')
    await act(() => vi.advanceTimersByTimeAsync(420))
    expect(document.querySelector('[data-leaving]')).toBeNull()
  })

  it('a swipe on the front card sends it back; a short drag springs back', async () => {
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

  it('keeps only the hand: the front card plus up to four edges behind it', async () => {
    renderOpener(async () => nine())
    await loadedPack()
    space()
    space()
    space()
    const hand = document.querySelectorAll('[data-hand-card]')
    expect(hand).toHaveLength(5)
    expect([...hand].map((el) => el.getAttribute('data-hand-card')).sort()).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4'
    ])
    // Only the front is a card you can see as such; the edges are decoration.
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Card 2' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Card 0' })).not.toBeInTheDocument()
  })

  it('Skip to the hit runs the cards to the back one by one and stops on the hit', async () => {
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
    expect(nextButton()).toBeEnabled()
    for (let i = 0; i < 3; i++) await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(count()).toBe('9 / 9')
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
    expect(screen.getByTestId('rip-caption')).toHaveTextContent('Dark Magician')
    expect(screen.getByTestId('rip-caption')).toHaveTextContent('Secret Rare')
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

  it('the next pack opens by itself once it has loaded', async () => {
    const second = deferred<RipCard[]>()
    const calls = [Promise.resolve(commons()), second.promise]
    const { api } = renderOpener(() => calls.shift() ?? new Promise(() => {}))
    await loadedPack()
    fireEvent.click(skipButton())
    fireEvent.click(nextButton())
    expect(screen.getByText(/pack 2 of 3/i)).toBeInTheDocument()
    expect(screen.getByTestId('rip-pack')).toBeInTheDocument()
    expect(screen.queryByTestId('rip-front')).not.toBeInTheDocument()
    await act(async () => second.resolve([card('Rare', 5, 'Next One'), card('Common', 6)]))
    await waitFor(() => expect(screen.queryByTestId('rip-pack')).not.toBeInTheDocument())
    expect(front()).toContainElement(screen.getByRole('img', { name: 'Card 6' }))
    expect(count()).toBe('1 / 2')
    expect(api.rip.openPack).toHaveBeenCalledTimes(2)
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
    space(skipButton())
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
    // The second pack opens itself; then Space on the disabled Next pack puts a card back.
    await waitFor(() => expect(count()).toBe('1 / 3'))
    const next = nextButton()
    expect(next).toBeDisabled()
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
})
