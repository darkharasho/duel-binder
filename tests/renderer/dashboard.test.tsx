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
    setPrice: 10,
    missingFromApi: false
  },
  imageId: 100 + id,
  unitPrice: 10,
  priceApproximate: false,
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
    const tile = (label: string): HTMLElement => screen.getByText(label).parentElement as HTMLElement
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
      api: createMockApi({ stats: { get: async () => stats({ pricesUpdatedAt: ago(3 * 86_400_000) }) } })
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

  it('top entry click navigates', async () => {
    const { onNavigate } = setup(stats())
    await userEvent.click(await screen.findByRole('button', { name: /Blue-Eyes White Dragon/ }))
    expect(onNavigate).toHaveBeenCalledWith('collection', { entryId: 2 })
  })

  it('empty state', async () => {
    const onAddCard = vi.fn()
    setup(
      stats({ totalCards: 0, uniqueCards: 0, totalValue: 0, byRarity: [], byFrameType: [], topEntries: [] }),
      { onAddCard }
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Add your first card' }))
    expect(onAddCard).toHaveBeenCalledTimes(1)
  })
})
