import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { HistoryTab } from '@/features/rip/HistoryTab'
import { SessionSummary, hitsLine } from '@/features/rip/SessionSummary'
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

describe('SessionSummary', () => {
  it('shows the headline, hits and best pulls rarest first, without prices', async () => {
    const onRipMore = vi.fn()
    const onPickSet = vi.fn()
    const { container } = renderWithProviders(
      <SessionSummary session={detail()} onRipMore={onRipMore} onPickSet={onPickSet} />
    )
    expect(screen.getByText('2 packs of Legend of Blue Eyes')).toBeInTheDocument()
    expect(screen.getByText(/6 cards/)).toBeInTheDocument()
    expect(screen.getByText('1 Secret · 1 Ultra · 2 Super')).toBeInTheDocument()
    const best = screen.getByTestId('rip-summary-best')
    const names = within(best)
      .getAllByRole('img')
      .map((i) => i.getAttribute('alt'))
    expect(names).toEqual(['Blue-Eyes', 'Red-Eyes', 'Dark Magician', 'Gaia'])
    expect(container.textContent).not.toMatch(/\$\d/)
    await userEvent.click(screen.getByRole('button', { name: /rip 2 more/i }))
    expect(onRipMore).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /pick another set/i }))
    expect(onPickSet).toHaveBeenCalled()
  })

  it('See all cards lists every card by pack', async () => {
    renderWithProviders(<SessionSummary session={detail()} />)
    expect(screen.queryByRole('button', { name: /rip \d+ more/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /see all cards/i }))
    expect(screen.getByText('Pack 1')).toBeInTheDocument()
    expect(screen.getByText('Pack 2')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Kuriboh' }).length).toBeGreaterThan(0)
  })
})

describe('SessionSummary without hits', () => {
  it('says so instead of showing a Common as the best pull', () => {
    const commons = [[card('Common', 0, 'Kuriboh'), card('Short Print', 1, 'Mooyan')]]
    renderWithProviders(
      <SessionSummary session={detail({ packs: commons, best: commons[0][0] })} />
    )
    expect(screen.getByText('No hits this time.')).toBeInTheDocument()
    expect(screen.queryByTestId('rip-summary-best')).not.toBeInTheDocument()
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
    expect(await screen.findByText('2 packs of Legend of Blue Eyes')).toBeInTheDocument()
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
