import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CollectionStats, EntryView } from '@shared/types'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { createMockApi, renderWithProviders } from './mockApi'

const entry = (id: number, name: string, extra: Partial<EntryView> = {}): EntryView => ({
  id,
  quantity: 2,
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  card: {
    id: 100 + id,
    name,
    type: 'Normal Monster',
    frameType: 'normal',
    race: 'Spellcaster',
    attribute: 'DARK',
    level: 7,
    linkval: null,
    atk: 2500,
    def: 2100,
    archetype: null,
    desc: '',
    tcgplayerPrice: 1
  },
  printing: {
    id,
    cardId: 100 + id,
    setName: 'Legend of Blue Eyes',
    setCode: `LOB-EN00${id}`,
    setRarity: 'Ultra Rare',
    setRarityCode: '(UR)',
    language: 'en',
    setPrice: 10,
    missingFromApi: false
  },
  imageId: 100 + id,
  originalArt: true,
  unitPrice: 10,
  priceApproximate: false,
  priceSource: 'ygoprodeck',
  priceCheckedAt: null,
  priceListingCount: null,
  noPriceReason: null,
  totalValue: 20,
  ...extra
})

const stats = (o: Partial<CollectionStats> = {}): CollectionStats => ({
  totalCards: 12,
  uniqueCards: 7,
  totalValue: 31.74,
  approximateCount: 0,
  byRarity: [
    { rarity: 'Common', count: 8, value: 4 },
    { rarity: 'Ultra Rare', count: 4, value: 27.74 }
  ],
  byFrameType: [
    { frameType: 'spell', count: 3 },
    { frameType: 'normal', count: 9 }
  ],
  topEntries: [entry(1, 'Dark Magician'), entry(2, 'Blue-Eyes White Dragon')],
  topSingles: [entry(2, 'Blue-Eyes White Dragon'), entry(1, 'Dark Magician')],
  recentEntries: [],
  valueHistory: [],
  pricesUpdatedAt: null,
  ...o
})

const setup = (s: CollectionStats, props: Partial<Parameters<typeof DashboardPage>[0]> = {}) => {
  const onNavigate = vi.fn()
  const api = createMockApi({ stats: { get: async () => s } })
  renderWithProviders(<DashboardPage onNavigate={onNavigate} {...props} />, { api })
  return { onNavigate }
}

describe('DashboardPage', () => {
  it('tiles show formatted stats', async () => {
    setup(stats())
    expect(await screen.findByText('$31.74')).toBeInTheDocument()
    const tile = (label: string): HTMLElement =>
      screen.getByText(label).parentElement as HTMLElement
    expect(within(tile('Total cards')).getByText('12')).toBeInTheDocument()
    expect(within(tile('Unique cards')).getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Total cards')).toBeInTheDocument()
    expect(screen.getByText('Prices updated')).toBeInTheDocument()
  })

  it('approximate note appears only when approximateCount > 0', async () => {
    const { unmount } = renderWithProviders(<DashboardPage onNavigate={vi.fn()} />, {
      api: createMockApi({ stats: { get: async () => stats() } })
    })
    await screen.findByText('$31.74')
    expect(screen.queryByText(/approximate price/)).not.toBeInTheDocument()
    unmount()
    setup(stats({ approximateCount: 3 }))
    expect(await screen.findByText('≈ includes 3 approximate prices')).toBeInTheDocument()
  })

  it('says how many cards the value leaves out for having no price', async () => {
    const { unmount } = renderWithProviders(<DashboardPage onNavigate={vi.fn()} />, {
      api: createMockApi({ stats: { get: async () => stats() } })
    })
    await screen.findByText('$31.74')
    expect(screen.queryByText(/no price yet/)).not.toBeInTheDocument()
    unmount()
    setup(stats({ unpricedCount: 4 }))
    expect(await screen.findByText('Leaves out 4 cards with no price yet')).toBeInTheDocument()
  })

  it('a rarity with no prices reads "No price", never $0.00', async () => {
    setup(
      stats({
        byRarity: [
          { rarity: 'Ultra Rare', count: 4, value: 27.74, unpriced: 1 },
          { rarity: 'Prismatic Secret Rare', count: 3, value: 0, unpriced: 3 }
        ]
      })
    )
    const items = (await screen.findByRole('list', { name: 'By rarity' })).querySelectorAll('li')
    expect(items[0]).toHaveTextContent('$27.74 · 4 (1 no price)')
    expect(items[1]).toHaveTextContent('Prismatic Secret Rare')
    expect(items[1]).toHaveTextContent('No price · 3')
    expect(items[1]).not.toHaveTextContent('$0.00')
  })

  it('lists rarities even when none has a price', async () => {
    setup(stats({ byRarity: [{ rarity: 'Secret Rare', count: 2, value: 0, unpriced: 2 }] }))
    const items = (await screen.findByRole('list', { name: 'By rarity' })).querySelectorAll('li')
    expect(items[0]).toHaveTextContent('No price · 2')
  })

  it('renders breakdowns sorted descending', async () => {
    setup(stats())
    const rarity = await screen.findByRole('list', { name: 'By rarity' })
    const items = rarity.querySelectorAll('li')
    expect(items[0]).toHaveTextContent('Ultra Rare')
    expect(items[0]).toHaveTextContent('$27.74')
    expect(items[0]).toHaveTextContent('4')
    expect(items[1]).toHaveTextContent('Common')
    const types = screen.getByRole('list', { name: 'By card type' }).querySelectorAll('li')
    expect(types[0]).toHaveTextContent('Normal')
    expect(types[1]).toHaveTextContent('Spell')
  })

  it('title-cases multi-word frame types', async () => {
    setup(stats({ byFrameType: [{ frameType: 'effect_pendulum', count: 2 }] }))
    expect(await screen.findByText('Effect Pendulum')).toBeInTheDocument()
  })

  it('flags stale prices only when older than 24 h', async () => {
    const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()
    const { unmount } = renderWithProviders(<DashboardPage onNavigate={vi.fn()} />, {
      api: createMockApi({
        stats: { get: async () => stats({ pricesUpdatedAt: ago(3 * 86_400_000) }) }
      })
    })
    expect(await screen.findByText('stale')).toBeInTheDocument()
    unmount()
    setup(stats({ pricesUpdatedAt: ago(3_600_000) }))
    expect(await screen.findByText('1 h ago')).toBeInTheDocument()
    expect(screen.queryByText('stale')).not.toBeInTheDocument()
  })

  it('approximate top entry shows ≈', async () => {
    setup(stats({ topEntries: [entry(1, 'Dark Magician', { priceApproximate: true })] }))
    const row = await screen.findByRole('button', { name: /Dark Magician/ })
    expect(within(row).getByLabelText('approximately')).toHaveTextContent('≈')
  })

  it('non-English top entries are labelled eBay, or No price when unpriced', async () => {
    const ja = (id: number, name: string, extra: Partial<EntryView>): EntryView =>
      entry(id, name, {
        printing: { ...entry(id, name).printing, language: 'ja', setCode: `LB-0${id}` },
        priceSource: 'ebay',
        priceCheckedAt: '2026-10-20T00:00:00.000Z',
        priceListingCount: 5,
        ...extra
      })
    setup(
      stats({
        topEntries: [
          ja(1, 'Dark Magician', { unitPrice: 40, totalValue: 80 }),
          ja(2, 'Blue-Eyes White Dragon', {
            unitPrice: null,
            totalValue: 0,
            noPriceReason: 'pending'
          })
        ]
      })
    )
    const priced = await screen.findByRole('button', { name: /Dark Magician/ })
    expect(within(priced).getByText('$80.00')).toBeInTheDocument()
    expect(within(priced).getByText('eBay')).toBeInTheDocument()
    const unpriced = screen.getByRole('button', { name: /Blue-Eyes White Dragon/ })
    expect(within(unpriced).getByText('No price')).toBeInTheDocument()
    expect(within(unpriced).queryByText('—')).not.toBeInTheDocument()
  })

  it('most valuable switches to the dearest single copies and remembers it', async () => {
    localStorage.removeItem('dashboard.mostValuableBy')
    const many = entry(1, 'Dark Magician', { quantity: 3, unitPrice: 10, totalValue: 30 })
    const dear = entry(2, 'Blue-Eyes White Dragon', { unitPrice: 25, totalValue: 25 })
    const { unmount } = renderWithProviders(<DashboardPage onNavigate={vi.fn()} />, {
      api: createMockApi({
        stats: { get: async () => stats({ topEntries: [many, dear], topSingles: [dear, many] }) }
      })
    })
    const names = (): string[] =>
      screen
        .getAllByRole('button', { name: /Dark Magician|Blue-Eyes/ })
        .map((b) => b.textContent ?? '')
    await screen.findByRole('button', { name: /Dark Magician/ })
    expect(names()[0]).toMatch(/Dark Magician/)
    expect(
      within(screen.getByRole('button', { name: /Dark Magician/ })).getByText('$30.00')
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Single' }))
    expect(names()[0]).toMatch(/Blue-Eyes/)
    expect(
      within(screen.getByRole('button', { name: /Dark Magician/ })).getByText('$10.00')
    ).toBeInTheDocument()
    expect(localStorage.getItem('dashboard.mostValuableBy')).toBe('single')
    unmount()
    localStorage.removeItem('dashboard.mostValuableBy')
  })

  it('top entry click navigates', async () => {
    const { onNavigate } = setup(stats())
    await userEvent.click(await screen.findByRole('button', { name: /Blue-Eyes White Dragon/ }))
    expect(onNavigate).toHaveBeenCalledWith('collection', { entryId: 2 })
  })

  it('value chart shows the change since the first recorded day', async () => {
    setup(
      stats({
        valueHistory: [
          { date: '2026-10-01', totalValue: 20, totalCards: 5 },
          { date: '2026-10-10', totalValue: 25, totalCards: 8 },
          { date: '2026-10-20', totalValue: 31.74, totalCards: 12 }
        ]
      })
    )
    const chart = await screen.findByRole('figure', { name: 'Value over time' })
    expect(within(chart).getByText('+$11.74')).toBeInTheDocument()
    expect(within(chart).getByText('(+58.7%)')).toBeInTheDocument()
    expect(within(chart).getByText('since Oct 1')).toBeInTheDocument()
  })

  it('value chart explains itself until there are two days', async () => {
    setup(stats({ valueHistory: [{ date: '2026-10-20', totalValue: 31.74, totalCards: 12 }] }))
    const chart = await screen.findByRole('figure', { name: 'Value over time' })
    expect(within(chart).getByText(/one point a day/)).toBeInTheDocument()
  })

  it('recently added lists entries newest first and navigates', async () => {
    const { onNavigate } = setup(
      stats({
        recentEntries: [
          entry(3, 'Kuriboh', { createdAt: new Date().toISOString() }),
          entry(4, 'Pot of Greed')
        ]
      })
    )
    const list = await screen.findByRole('list', { name: 'Recently added' })
    const items = within(list).getAllByRole('button')
    expect(items[0]).toHaveTextContent('Kuriboh')
    expect(items[0]).toHaveTextContent('just now')
    await userEvent.click(items[1])
    expect(onNavigate).toHaveBeenCalledWith('collection', { entryId: 4 })
  })

  it('empty state', async () => {
    const onAddCard = vi.fn()
    setup(
      stats({
        totalCards: 0,
        uniqueCards: 0,
        totalValue: 0,
        byRarity: [],
        byFrameType: [],
        topEntries: []
      }),
      { onAddCard }
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Add your first card' }))
    expect(onAddCard).toHaveBeenCalledTimes(1)
  })
})
