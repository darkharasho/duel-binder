import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  BrowseCard,
  BrowseFilters,
  CardDetail,
  ChecklistCard,
  EntryView,
  Printing
} from '@shared/types'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'
import type { Api } from '@shared/ipc'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const card = (id: number, name: string, o: Partial<BrowseCard> = {}): BrowseCard => ({
  id,
  name,
  type: 'Normal Monster',
  frameType: 'normal',
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 7,
  linkval: null,
  atk: 2500,
  def: 2100,
  imageId: id,
  price: 7.5,
  releasedAt: '2002-03-08',
  owned: 0,
  defaultPrintingId: id * 10,
  ...o
})

const printing = (id: number, extra: Partial<Printing> = {}): Printing => ({
  id,
  cardId: 1,
  setName: 'Legend of Blue Eyes',
  setCode: `LOB-EN00${id}`,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 10,
  missingFromApi: false,
  ...extra
})

const detail: CardDetail = {
  card: {
    id: 1,
    name: 'Dark Magician',
    type: 'Normal Monster',
    frameType: 'normal',
    race: 'Spellcaster',
    attribute: 'DARK',
    level: 7,
    linkval: null,
    atk: 2500,
    def: 2100,
    archetype: null,
    desc: 'The ultimate wizard.',
    tcgplayerPrice: 1
  },
  printings: [
    printing(11, { setName: 'Duelist Pack', setCode: 'DP-JP001', language: 'ja' }),
    printing(10)
  ],
  images: [{ imageId: 1, cardId: 1, sortOrder: 0 }]
}

const copy: EntryView = {
  id: 7,
  quantity: 2,
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  card: detail.card,
  printing: printing(10),
  imageId: 1,
  originalArt: true,
  unitPrice: 10,
  priceApproximate: false,
  priceSource: 'ygoprodeck',
  priceCheckedAt: null,
  priceListingCount: null,
  noPriceReason: null,
  totalValue: 20
}

const setup = (
  cards: BrowseCard[],
  total = cards.length,
  api: DeepPartial<Api> = {}
): { browse: ReturnType<typeof vi.fn>; onAddCard: ReturnType<typeof vi.fn> } => {
  const browse = vi.fn(async (f: BrowseFilters) => ({
    cards: cards.slice(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 120)),
    total
  }))
  const onAddCard = vi.fn()
  renderWithProviders(<BrowsePage onAddCard={onAddCard} />, {
    api: createMockApi({ ...api, cards: { browse, get: async () => detail, ...api.cards } })
  })
  return { browse, onAddCard }
}

describe('BrowsePage', () => {
  it('shows every card with stats, price, owned count and the total', async () => {
    setup([
      card(1, 'Dark Magician', { owned: 2 }),
      card(2, 'Pot of Greed', { atk: null, def: null, race: 'Normal' })
    ])
    const dm = await screen.findByRole('button', { name: /Dark Magician/ })
    expect(dm).toHaveTextContent('★7 · 2500 / 2100')
    expect(dm).toHaveTextContent('$7.50')
    expect(within(dm).getByText('×2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pot of Greed/ })).toHaveTextContent('Normal')
    expect(screen.getByText('2 cards')).toBeInTheDocument()
  })

  it('search, the owned tab and sort go to the query', async () => {
    const { browse } = setup([card(1, 'Dark Magician')])
    await screen.findByRole('button', { name: /Dark Magician/ })
    await userEvent.type(screen.getByLabelText('Search cards'), 'dark')
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'dark' }))
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Not owned' }))
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ owned: 'missing', offset: 0 })
      )
    )
  })

  it('clicking a card not owned opens a panel with a stepper per printing, English first', async () => {
    const adjust = vi.fn(async () => ({}) as ChecklistCard)
    setup([card(1, 'Dark Magician')], 1, { sets: { adjust } })
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText('You have none yet')).toBeInTheDocument()
    const rows = await within(panel).findAllByRole('group')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Dark Magician LOB-EN0010 Ultra Rare',
      'Dark Magician DP-JP001 Ultra Rare'
    ])
    await userEvent.click(
      within(panel).getByRole('button', { name: 'Add one Dark Magician DP-JP001 Ultra Rare' })
    )
    await waitFor(() => expect(adjust).toHaveBeenCalledWith('Duelist Pack', 'ja', 11, 1))
  })

  it('the panel prices the printing its art shows, and each printing its own price', async () => {
    setup([card(1, 'Dark Magician')])
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    const panel = await screen.findByRole('dialog')
    const rows = await within(panel).findAllByRole('group')
    expect(within(panel).getByText(/^Market price/).parentElement).toHaveTextContent(
      'Market price · Ultra Rare $10.00'
    )
    for (const row of rows) expect(within(row).getByText('$10.00')).toBeInTheDocument()
  })

  it('the panel falls back to the cheapest-printing price, saying so', async () => {
    setup([card(1, 'Dark Magician', { defaultPrintingId: null })])
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    const panel = await screen.findByRole('dialog')
    await within(panel).findAllByRole('group')
    expect(within(panel).getByText(/^Market price/).parentElement).toHaveTextContent(
      'Market price · cheapest printing $7.50'
    )
  })

  it('More options… in the panel opens Add with the default printing', async () => {
    const { onAddCard } = setup([card(1, 'Dark Magician')])
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    const panel = await screen.findByRole('dialog')
    await userEvent.click(within(panel).getByRole('button', { name: 'More options…' }))
    expect(onAddCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Dark Magician' }),
      10
    )
  })

  it('clicking an owned card opens its first copy in the entry editor', async () => {
    setup([card(1, 'Dark Magician', { owned: 2 })], 1, {
      collection: { forCard: async () => [copy] }
    })
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    const panel = await screen.findByRole('dialog')
    expect(await within(panel).findByText('Your copies')).toBeInTheDocument()
  })

  it('arrows step through the results, opening each as a click would', async () => {
    setup([card(1, 'Dark Magician', { owned: 2 }), card(2, 'Pot of Greed')], 2, {
      collection: { forCard: async (id: number) => (id === 1 ? [copy] : []) }
    })
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    const panel = await screen.findByRole('dialog')
    expect(await within(panel).findByText('Your copies')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Previous card' })[0]).toBeDisabled()

    await userEvent.click(screen.getAllByRole('button', { name: 'Next card' })[0])
    expect(await within(panel).findByText('You have none yet')).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Pot of Greed' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Next card' })[0]).toBeDisabled()
    // Switching panel kinds keeps the same sheet open.
    expect(screen.getByRole('dialog')).toBe(panel)

    await userEvent.click(screen.getAllByRole('button', { name: 'Previous card' })[0])
    expect(await within(panel).findByText('Your copies')).toBeInTheDocument()
  })

  it('Load more fetches the next page', async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      card(i + 1, `Card ${String(i + 1).padStart(3, '0')}`)
    )
    const { browse } = setup(many)
    await screen.findByRole('button', { name: /Card 001/ })
    expect(screen.queryByRole('button', { name: /Card 121/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('button', { name: /Card 121/ })).toBeInTheDocument()
    expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 120 }))
  })
})
