import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EntryView, Friend, FriendStats, Printing, CardRow } from '@shared/types'
import { FriendBinder } from '@/features/friends/FriendBinder'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist } from './setFixtures'

const friend: Friend = {
  id: 7,
  username: 'bob',
  displayName: 'Bob',
  avatarUrl: null,
  cardCount: 2,
  updatedAt: null
}
const entry = (id: number, name: string, cardId: number): EntryView =>
  ({
    id,
    quantity: 2,
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    card: { id: cardId, name, type: 'Normal Monster', frameType: 'normal' } as CardRow,
    printing: {
      id,
      cardId,
      setName: 'Metal Raiders',
      setCode: 'MRD-001',
      setRarity: 'Ultra Rare',
      language: 'en'
    } as Printing,
    imageId: cardId,
    printingScan: false,
    unitPrice: 10,
    priceApproximate: false,
    priceSource: 'ygoprodeck',
    priceCheckedAt: null,
    priceListingCount: null,
    noPriceReason: null,
    totalValue: 20
  }) as EntryView
const alpha = entry(7, 'Alpha Dragon', 1001)
const stats: FriendStats = {
  totalCards: 1284,
  uniqueCards: 742,
  totalValue: 3410,
  approximateCount: 0,
  unpricedCount: 3,
  byRarity: [{ rarity: 'Ultra Rare', count: 2, value: 20 }],
  byFrameType: [{ frameType: 'normal', count: 2 }],
  topEntries: [alpha],
  topSingles: [alpha],
  recentEntries: [alpha],
  valueHistory: [],
  pricesUpdatedAt: null,
  sharedCards: 118
}
const { set } = metalRaidersChecklist

function open(over: Partial<ReturnType<typeof createMockApi>['friends']> = {}): {
  api: ReturnType<typeof createMockApi>
  onBack: ReturnType<typeof vi.fn>
} {
  const api = createMockApi({
    friends: {
      stats: vi.fn(async () => stats),
      collection: vi.fn(async () => [alpha]),
      sets: vi.fn(async () => [
        { ...set, setName: 'Barely', ownedCards: 1, totalCards: 100 },
        { ...set, setName: 'Untouched', ownedCards: 0 },
        { ...set, setName: 'Metal Raiders', ownedCards: 2, totalCards: 3 }
      ]),
      checklist: vi.fn(async () => metalRaidersChecklist),
      ...over
    }
  })
  const onBack = vi.fn()
  renderWithProviders(<FriendBinder friend={friend} onBack={onBack} />, { api })
  return { api, onBack }
}

afterEach(() => {
  window.api = undefined as never
})

describe("a friend's binder", () => {
  it('opens on the Dashboard under their name', async () => {
    const { onBack } = open()
    expect(screen.getByRole('heading', { name: 'Bob' })).toBeInTheDocument()
    expect(screen.getByText(/@bob/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dashboard' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Back to mine' })).not.toBeInTheDocument()
    const s = within(await screen.findByRole('region', { name: 'Stats' }))
    expect(s.getByText('$3,410.00')).toBeInTheDocument()
    expect(s.getByText('1,284')).toBeInTheDocument()
    expect(s.getByText('118')).toBeInTheDocument()
    expect(s.getByText(/Leaves out 3 cards/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'All friends' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('opens a dashboard card in the Collection tab, read-only', async () => {
    open()
    const [pick] = await screen.findAllByRole('button', { name: /Alpha Dragon/ })
    await userEvent.click(pick)
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('region', { name: 'Their copies' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Collection', hidden: true })).toBeChecked()
  })

  it('says so when they have no cards in this game', async () => {
    open({ stats: vi.fn(async () => ({ ...stats, totalCards: 0 })) })
    expect(await screen.findByText("Bob hasn't added any cards yet")).toBeInTheDocument()
  })

  it('offers Retry when the dashboard fails, and recovers', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(stats)
    open({ stats: get })
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('region', { name: 'Stats' })).toBeInTheDocument()
  })

  it('lists only started sets, closest to complete first', async () => {
    open()
    await userEvent.click(screen.getByRole('radio', { name: 'Sets' }))
    const list = await screen.findByRole('list', { name: "Bob's sets" })
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Metal Raiders')
    expect(rows[1]).toHaveTextContent('Barely')
  })

  it("shows a set read-only with the friend's copies", async () => {
    const { api } = open()
    await userEvent.click(screen.getByRole('radio', { name: 'Sets' }))
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    await screen.findByRole('heading', { name: /Metal Raiders/ })
    expect(api.friends.checklist).toHaveBeenCalledWith(7, 'Metal Raiders', 'en')
    expect(api.sets.checklist).not.toHaveBeenCalled()
    expect(api.prices.request).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Bulk add' })).not.toBeInTheDocument()
    const missing = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('data-owned') === 'false')
    expect(missing.length).toBeGreaterThan(0)
    missing.forEach((b) => expect(b).toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: 'Alpha Dragon' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('region', { name: 'Their copies' })).toBeInTheDocument()
    await waitFor(() => expect(api.collection.forCard).not.toHaveBeenCalled())
  })
})
