import { act, render } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { ArtWashContext, pickOrder, useArtWash, type WashState } from '@/components/artWashContext'
import type { Families } from '@/lib/wash/families'
import { type WashCard, gameFallback, sampleCard } from '@/lib/wash/sample'

vi.mock('@/lib/wash/sample', () => ({
  sampleCard: vi.fn(),
  gameFallback: vi.fn()
}))

const colourful = { greyArt: false, fams: [{}], tag: 'colour' } as unknown as Families
const grey = { greyArt: true, fams: [{}], tag: 'grey' } as unknown as Families
const fallback = { greyArt: false, fams: [{}], tag: 'fallback' } as unknown as Families

const card = (imageId: number): WashCard => ({ imageId })
const [a, b, c, d] = [card(1), card(2), card(3), card(4)]

const sample = vi.mocked(sampleCard)
let set: ReturnType<typeof vi.fn>

function Probe({ cards }: { cards: WashCard[] | null | undefined }): ReactNode {
  useArtWash(cards)
  return null
}
const tree = (cards: WashCard[] | null | undefined): ReactNode => (
  <ArtWashContext.Provider value={set as (w: WashState | null) => void}>
    <Probe cards={cards} />
  </ArtWashContext.Provider>
)
const flush = (): Promise<void> => act(async () => {})

beforeEach(() => {
  set = vi.fn()
  sample.mockReset()
  vi.mocked(gameFallback).mockReturnValue(fallback)
})
afterEach(() => vi.restoreAllMocks())

describe('pickOrder', () => {
  it('shuffles the first 24 as a permutation', () => {
    let s = 7
    const rand = (): number => (s = (s * 16807) % 2147483647) / 2147483647
    const xs = Array.from({ length: 30 }, (_, i) => i + 1)
    const out = pickOrder(xs, rand)
    expect(out).toHaveLength(24)
    expect([...out].sort((p, q) => p - q)).toEqual(xs.slice(0, 24))
  })
})

describe('useArtWash', () => {
  it('picks once when the list first fills, and not again on append or filter', async () => {
    sample.mockResolvedValue(colourful)
    const { rerender } = render(tree(null))
    await flush()
    expect(set).not.toHaveBeenCalled()
    rerender(tree([a, b, c]))
    await flush()
    expect(set).toHaveBeenCalledTimes(1)
    const w = set.mock.calls[0][0] as WashState
    expect(w.families).toBe(colourful)
    expect(w.strength).toBe(1)
    rerender(tree([a, b, c, d]))
    rerender(tree([c]))
    await flush()
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('does nothing for undefined', async () => {
    render(tree(undefined))
    await flush()
    expect(sample).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('picks again after unmount and remount', async () => {
    sample.mockResolvedValue(colourful)
    const first = render(tree([a, b]))
    await flush()
    first.unmount()
    render(tree([a, b]))
    await flush()
    expect(set).toHaveBeenCalledTimes(2)
  })

  it('uses the first sampled card when every card is grey', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99) // shuffle leaves the order as it is
    sample.mockResolvedValue(grey)
    render(tree([a, b, c]))
    await flush()
    const w = set.mock.calls[0][0] as WashState
    expect(w.families).toBe(grey)
    expect(w.seed).toBe(1)
  })

  it('uses the game fallback when no card samples', async () => {
    sample.mockResolvedValue(null)
    render(tree([a, b]))
    await flush()
    expect((set.mock.calls[0][0] as WashState).families).toBe(fallback)
  })

  it('drops a sample that resolves after unmount', async () => {
    let resolve!: (f: Families) => void
    sample.mockReturnValue(new Promise((r) => (resolve = r)))
    const { unmount } = render(tree([a]))
    unmount()
    resolve(colourful)
    await flush()
    expect(set).not.toHaveBeenCalled()
  })

  it('prefers a colourful card over a grey one that comes first', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99) // order stays [grey card, colourful card]
    sample.mockImplementation(async (card) => (card.imageId === 1 ? grey : colourful))
    render(tree([a, b]))
    await flush()
    const w = set.mock.calls[0][0] as WashState
    expect(w.families).toBe(colourful)
    expect(w.seed).toBe(2)
  })

  it('sets once under StrictMode', async () => {
    sample.mockResolvedValue(colourful)
    render(<StrictMode>{tree([a, b, c])}</StrictMode>)
    await flush()
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('drops a walk in flight when unmounted, and sets only the remounted walk', async () => {
    const pending: Array<(f: Families) => void> = []
    sample.mockImplementation(() => new Promise((r) => pending.push(r)))
    const first = render(tree([a]))
    first.unmount()
    render(tree([b]))
    expect(pending).toHaveLength(2)
    pending[0](grey)
    pending[1](colourful)
    await flush()
    expect(set).toHaveBeenCalledTimes(1)
    expect((set.mock.calls[0][0] as WashState).seed).toBe(2)
  })

  it('skips a card with no colour list in favour of a colourful one', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const empty = { greyArt: false, fams: [], tag: 'empty' } as unknown as Families
    sample.mockImplementation(async (card) => (card.imageId === 1 ? empty : colourful))
    render(tree([a, b]))
    await flush()
    expect((set.mock.calls[0][0] as WashState).families).toBe(colourful)
  })

  it('stops after a few unreadable cards and uses the game colours', async () => {
    sample.mockResolvedValue(null)
    const many = Array.from({ length: 20 }, (_, i) => card(i + 1))
    render(tree(many))
    await flush()
    expect(sample).toHaveBeenCalledTimes(6)
    expect((set.mock.calls[0][0] as WashState).families).toBe(fallback)
  })

  it('keeps the current wash when the pick is too late', async () => {
    let resolve!: (f: Families) => void
    sample.mockReturnValue(new Promise((r) => (resolve = r)))
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    render(tree([a]))
    now.mockReturnValue(1000 + 7000)
    resolve(colourful)
    await flush()
    expect(set).not.toHaveBeenCalled()
  })

  it('drops the list walk when a child view takes over', async () => {
    let resolve!: (f: Families) => void
    sample.mockReturnValue(new Promise((r) => (resolve = r)))
    const { rerender } = render(tree([a]))
    rerender(tree(undefined))
    resolve(colourful)
    await flush()
    expect(set).not.toHaveBeenCalled()
  })
})
