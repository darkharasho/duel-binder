import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { HistoryTab } from '@/features/rip/HistoryTab'
import { SessionSummary, hitsLine, rankedHits } from '@/features/rip/SessionSummary'
import type {
  RipCard,
  RipHistory,
  RipSessionDetail,
  RipSessionSummary
} from '../../src/shared/rip/types'
import { createMockApi, renderWithProviders } from './mockApi'

const card = (rarity: string, slot: number, name = `Card ${slot}`): RipCard => ({
  pkey: `k${slot}-${rarity}`,
  cardId: slot,
  name,
  setCode: `LOB-EN00${slot}`,
  rarity,
  variant: null,
  frameType: 'normal',
  imageId: slot,
  slot
})

const packs = [
  [
    card('Common', 0, 'Kuriboh'),
    card('Super Rare', 1, 'Dark Magician'),
    card('Common', 2, 'Mooyan')
  ],
  [
    card('Secret Rare', 0, 'Blue-Eyes'),
    card('Ultra Rare', 1, 'Red-Eyes'),
    card('Super Rare', 2, 'Gaia')
  ]
]

const detail = (over: Partial<RipSessionDetail> = {}): RipSessionDetail => ({
  id: 3,
  setName: 'Legend of Blue Eyes',
  setCode: 'LOB',
  packCount: 2,
  packsOpened: 2,
  startedAt: '2026-10-20T15:00:00.000Z',
  best: packs[1][0],
  packs,
  ...over
})

describe('hitsLine', () => {
  it('counts big and huge hits, rarest first, dropping " Rare"', () => {
    const cards = [
      card('Common', 0),
      card('Super Rare', 1),
      card('Super Rare', 2),
      card('Super Rare', 3),
      card('Ultra Rare', 4),
      card('Secret Rare', 5)
    ]
    expect(hitsLine(cards)).toBe('1 Secret · 1 Ultra · 3 Super')
  })
  it('is empty without hits', () => {
    expect(hitsLine([card('Common', 0)])).toBe('')
  })
})

const realMatchMedia = window.matchMedia
function motion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    ...realMatchMedia(q),
    matches: reduce && q.includes('reduce')
  }))
}

describe('rankedHits', () => {
  it('ranks the hits rarest first, ties in the order pulled, with their pack', () => {
    const ranked = rankedHits([
      [card('Common', 0, 'Kuriboh'), card('Secret Rare', 1, 'First Secret')],
      [card('Rare', 0, 'A Rare'), card('Secret Rare', 1, 'Second Secret')]
    ])
    expect(ranked.map((p) => [p.card.name, p.pack])).toEqual([
      ['First Secret', 1],
      ['Second Secret', 2],
      ['A Rare', 2]
    ])
  })
  it('is empty without a Rare or better', () => {
    expect(rankedHits([[card('Common', 0), card('Short Print', 1)]])).toEqual([])
  })
})

describe('SessionSummary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the headline, the best pull as the hero, tally chips and the other hits, without prices', async () => {
    const onRipMore = vi.fn()
    const onPickSet = vi.fn()
    const { container } = renderWithProviders(
      <SessionSummary session={detail()} onRipMore={onRipMore} onPickSet={onPickSet} />
    )
    expect(screen.getByTestId('rip-summary-headline')).toHaveTextContent(
      '2 packs · Legend of Blue Eyes · 6 cards'
    )
    const hero = screen.getByTestId('rip-summary-hero')
    expect(hero).toHaveAttribute('data-tier', 'huge')
    expect(screen.getByTestId('rip-summary-hero-name')).toHaveTextContent('Blue-Eyes')
    expect(within(hero).getByRole('img', { name: 'Blue-Eyes' })).toBeInTheDocument()
    expect(hero).toHaveTextContent('LOB-EN000 · from pack 2')
    expect(hero).toHaveTextContent(/best pull/i)
    expect(screen.getAllByTestId('rip-summary-chip').map((c) => c.textContent)).toEqual([
      '1 Secret',
      '1 Ultra',
      '2 Super',
      '6 cards'
    ])
    // Every other card: the rest of the hits rarest first (Supers as pulled), then the others.
    const others = screen.getByTestId('rip-summary-others')
    expect(
      within(others)
        .getAllByRole('img')
        .map((i) => i.getAttribute('alt'))
    ).toEqual(['Red-Eyes', 'Dark Magician', 'Gaia', 'Kuriboh', 'Mooyan'])
    expect(others).toHaveTextContent('Ultra · Red-Eyes')
    expect(container.textContent).not.toMatch(/\$\d/)
    await userEvent.click(screen.getByRole('button', { name: /rip 2 more/i }))
    expect(onRipMore).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /pick another set/i }))
    expect(onPickSet).toHaveBeenCalled()
  })

  it('on a tie the best pull is the earliest', () => {
    const tied = [
      [card('Common', 0, 'Kuriboh'), card('Ultra Rare', 1, 'Early Ultra')],
      [card('Ultra Rare', 0, 'Late Ultra'), card('Super Rare', 1, 'Gaia')]
    ]
    renderWithProviders(<SessionSummary session={detail({ packs: tied })} />)
    expect(screen.getByTestId('rip-summary-hero-name')).toHaveTextContent('Early Ultra')
    expect(screen.getByTestId('rip-summary-hero')).toHaveTextContent('from pack 1')
    expect(
      within(screen.getByTestId('rip-summary-others'))
        .getAllByRole('img')
        .map((i) => i.getAttribute('alt'))
    ).toEqual(['Late Ultra', 'Gaia', 'Kuriboh'])
  })

  it('a huge hit gets rays and sparkles; a Rare just lands, with no rays or sparkles', () => {
    motion(false)
    const { unmount } = renderWithProviders(<SessionSummary session={detail()} />)
    expect(screen.getByTestId('rip-summary-rays')).toBeInTheDocument()
    expect(screen.getAllByTestId('rip-summary-spark')).toHaveLength(12)
    expect(screen.getByTestId('rip-summary-hero').innerHTML).toContain('rip-shake')
    unmount()
    const big = renderWithProviders(
      <SessionSummary session={detail({ packs: [[card('Super Rare', 0, 'Plain Super')]] })} />
    )
    expect(screen.getByTestId('rip-summary-hero')).toHaveAttribute('data-tier', 'big')
    expect(screen.getByTestId('rip-summary-rays')).toBeInTheDocument()
    expect(screen.getAllByTestId('rip-summary-spark')).toHaveLength(6)
    expect(screen.getByTestId('rip-summary-hero').innerHTML).not.toContain('rip-shake')
    big.unmount()
    renderWithProviders(
      <SessionSummary session={detail({ packs: [[card('Rare', 0, 'Plain Rare')]] })} />
    )
    expect(screen.getByTestId('rip-summary-hero')).toHaveAttribute('data-tier', 'rare')
    expect(screen.getByTestId('rip-summary-bloom')).toBeInTheDocument()
    expect(screen.queryByTestId('rip-summary-rays')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rip-summary-spark')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rip-summary-others')).not.toBeInTheDocument()
  })

  it('with reduced motion there are no sparkles and the card does not land', () => {
    motion(true)
    renderWithProviders(<SessionSummary session={detail()} />)
    expect(screen.getByTestId('rip-summary-hero')).toBeInTheDocument()
    expect(screen.queryByTestId('rip-summary-spark')).not.toBeInTheDocument()
    expect(screen.getByTestId('rip-summary-card').className).toContain('motion-reduce:animate-none')
  })

  it('See all cards lists every card by pack, and Hide cards brings the hero back', async () => {
    renderWithProviders(<SessionSummary session={detail()} />)
    expect(screen.queryByRole('button', { name: /rip \d+ more/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pick another set/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /see all cards/i }))
    // The hero stays laid out (not display:none), so it doesn't replay when it comes back.
    const stage = screen.getByTestId('rip-summary-fanfare')
    expect(stage).toBeInTheDocument()
    expect(stage).toHaveClass('invisible')
    expect(stage).not.toHaveAttribute('hidden')
    expect(screen.getByText('Pack 1')).toBeInTheDocument()
    expect(screen.getByText('Pack 2')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('rip-summary-all')).getAllByRole('img', { name: 'Kuriboh' })
    ).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /hide cards/i }))
    expect(screen.queryByTestId('rip-summary-all')).not.toBeInTheDocument()
    expect(screen.getByTestId('rip-summary-hero')).toBeVisible()
  })
})

describe('SessionSummary focus', () => {
  it('clicking a card brings it up large with its details; arrows step, Escape closes', async () => {
    renderWithProviders(<SessionSummary session={detail()} />)
    expect(screen.queryByTestId('rip-summary-focus')).not.toBeInTheDocument()
    await userEvent.click(
      within(screen.getByTestId('rip-summary-others')).getByRole('button', {
        name: 'Look at Kuriboh'
      })
    )
    const focus = screen.getByTestId('rip-summary-focus')
    expect(within(focus).getByRole('img', { name: 'Kuriboh' })).toBeInTheDocument()
    expect(focus).toHaveTextContent('LOB-EN000')
    // Clicking the card itself keeps it up.
    await userEvent.click(within(focus).getByRole('img', { name: 'Kuriboh' }))
    expect(screen.getByTestId('rip-summary-focus')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}')
    expect(within(focus).getByRole('img', { name: 'Mooyan' })).toBeInTheDocument()
    // Past the last card it wraps round to the best pull.
    await userEvent.keyboard('{ArrowRight}')
    expect(within(focus).getByRole('img', { name: 'Blue-Eyes' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('rip-summary-focus')).not.toBeInTheDocument()
  })

  it('the best pull and the See all list open it too; a click outside closes it', async () => {
    renderWithProviders(<SessionSummary session={detail()} />)
    await userEvent.click(
      within(screen.getByTestId('rip-summary-hero')).getByRole('button', {
        name: 'Look at Blue-Eyes'
      })
    )
    await userEvent.click(screen.getByTestId('rip-summary-focus'))
    expect(screen.queryByTestId('rip-summary-focus')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /see all cards/i }))
    await userEvent.click(
      within(screen.getByTestId('rip-summary-all')).getByRole('button', { name: 'Look at Gaia' })
    )
    expect(
      within(screen.getByTestId('rip-summary-focus')).getByRole('img', { name: 'Gaia' })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('rip-summary-focus')).not.toBeInTheDocument()
  })
})

describe('SessionSummary without hits', () => {
  it('says so, with no hero or fanfare', () => {
    const commons = [[card('Common', 0, 'Kuriboh'), card('Short Print', 1, 'Mooyan')]]
    renderWithProviders(
      <SessionSummary session={detail({ packs: commons, best: commons[0][0] })} />
    )
    expect(screen.getByText('No hits this time.')).toBeInTheDocument()
    expect(screen.getByTestId('rip-summary-headline')).toHaveTextContent('2 packs')
    expect(screen.queryByTestId('rip-summary-hero')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rip-summary-rays')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rip-summary-spark')).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('rip-summary-others'))
        .getAllByRole('img')
        .map((i) => i.getAttribute('alt'))
    ).toEqual(['Kuriboh', 'Mooyan'])
    expect(screen.getByRole('button', { name: /see all cards/i })).toBeInTheDocument()
  })
})

describe('HistoryTab', () => {
  const history = (over: Partial<RipHistory> = {}): RipHistory => ({
    packsOpened: 7,
    cardsPulled: 63,
    setsRipped: 2,
    bestPulls: [packs[1][0]],
    sessions: [
      {
        id: 3,
        setName: 'Legend of Blue Eyes',
        setCode: 'LOB',
        packCount: 2,
        packsOpened: 2,
        startedAt: '2026-10-20T15:00:00.000Z',
        best: packs[1][0]
      }
    ],
    ...over
  })

  it('shows an empty state when nothing has been ripped', async () => {
    renderWithProviders(<HistoryTab />, {
      api: createMockApi({
        rip: {
          history: vi.fn(async () =>
            history({ packsOpened: 0, cardsPulled: 0, setsRipped: 0, bestPulls: [], sessions: [] })
          )
        }
      })
    })
    expect(await screen.findByText(/nothing ripped yet/i)).toBeInTheDocument()
  })

  it('renders totals and opens a session without rip buttons', async () => {
    const session = vi.fn(async () => detail())
    const { container } = renderWithProviders(<HistoryTab />, {
      api: createMockApi({ rip: { history: vi.fn(async () => history()), session } })
    })
    expect(await screen.findByText('63')).toBeInTheDocument()
    expect(screen.getByText('Packs opened').previousSibling).toHaveTextContent('7')
    expect(screen.getByText(/best pulls ever/i)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\$\d/)
    await userEvent.click(screen.getByRole('button', { name: /Legend of Blue Eyes/ }))
    expect(await screen.findByTestId('rip-summary-headline')).toHaveTextContent(
      '2 packs · Legend of Blue Eyes'
    )
    expect(screen.getByTestId('rip-summary-hero-name')).toHaveTextContent('Blue-Eyes')
    expect(session).toHaveBeenCalledWith(3)
    expect(screen.queryByRole('button', { name: /pick another set/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText(/best pulls ever/i)).toBeInTheDocument()
  })

  it('Show more loads the next page of sessions by offset', async () => {
    const mk = (id: number): RipSessionSummary => ({
      ...history().sessions[0],
      id,
      setName: `Set ${id}`
    })
    const page1 = Array.from({ length: 50 }, (_, i) => mk(i + 1))
    const hist = vi.fn(async (opts?: { sessionOffset?: number }) =>
      history({ sessions: opts?.sessionOffset ? [mk(99)] : page1 })
    )
    renderWithProviders(<HistoryTab />, { api: createMockApi({ rip: { history: hist } }) })
    await userEvent.click(await screen.findByRole('button', { name: /show more/i }))
    expect(await screen.findByRole('button', { name: /Set 99/ })).toBeInTheDocument()
    expect(hist).toHaveBeenLastCalledWith({ sessionOffset: 50 })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
    )
  })

  it('lists a session once when paging repeats it', async () => {
    const mk = (id: number): RipSessionSummary => ({
      ...history().sessions[0],
      id,
      setName: `Set ${id}`
    })
    const page1 = Array.from({ length: 50 }, (_, i) => mk(i + 1))
    const hist = vi.fn(async (opts?: { sessionOffset?: number }) =>
      history({ sessions: opts?.sessionOffset ? [mk(50)] : page1 })
    )
    renderWithProviders(<HistoryTab />, { api: createMockApi({ rip: { history: hist } }) })
    await userEvent.click(await screen.findByRole('button', { name: /show more/i }))
    await waitFor(() => expect(hist).toHaveBeenCalledTimes(2))
    expect(screen.getAllByRole('button', { name: /Set 50/ })).toHaveLength(1)
  })
})
