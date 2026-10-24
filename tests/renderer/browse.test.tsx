import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BrowseCard, BrowseFilters } from '@shared/types'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { createMockApi, renderWithProviders } from './mockApi'

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

const setup = (
  cards: BrowseCard[],
  total = cards.length
): { browse: ReturnType<typeof vi.fn>; onAddCard: ReturnType<typeof vi.fn> } => {
  const browse = vi.fn(async (f: BrowseFilters) => ({
    cards: cards.slice(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 120)),
    total
  }))
  const onAddCard = vi.fn()
  renderWithProviders(<BrowsePage onAddCard={onAddCard} />, {
    api: createMockApi({ cards: { browse } })
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

  it('clicking a card opens Add with its default printing', async () => {
    const { onAddCard } = setup([card(1, 'Dark Magician')])
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    expect(onAddCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Dark Magician' }),
      10
    )
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
