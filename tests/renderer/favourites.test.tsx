import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { BrowseCard, BrowseFilters, CardRow, EntryView, Friend, Printing } from '@shared/types'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { createMockApi, renderWithProviders } from './mockApi'
import { stubWideWindow } from './filterTestHelpers'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const card = (id: number, name: string): CardRow => ({
  id,
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
  desc: 'A wizard.',
  tcgplayerPrice: 1
})
const printing = (id: number, cardId: number): Printing => ({
  id,
  cardId,
  setName: 'Legend of Blue Eyes',
  setCode: `LOB-EN00${id}`,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 10,
  missingFromApi: false
})
const entry = (id: number, name: string): EntryView => ({
  id,
  quantity: 2,
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  card: card(100 + id, name),
  printing: printing(id, 100 + id),
  imageId: 100 + id,
  printingScan: true,
  unitPrice: 10,
  priceApproximate: false,
  priceSource: 'ygoprodeck',
  priceCheckedAt: null,
  priceListingCount: null,
  noPriceReason: null,
  totalValue: 20
})
const browseCard = (id: number, name: string): BrowseCard => ({
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
  defaultPrintingId: id * 10
})

const dm = entry(1, 'Dark Magician')
const bew = entry(2, 'Blue-Eyes White Dragon')
const bob: Friend = {
  id: 7,
  username: 'bob',
  displayName: 'Bob',
  avatarUrl: null,
  cardCount: 2,
  updatedAt: null
}

describe('favourite hearts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(toast.error).mockClear()
  })

  it('hearts a card from its collection tile at once, without opening it', async () => {
    // The write never answers: what shows is the optimistic state.
    const set = vi.fn(() => new Promise<void>(() => {}))
    const get = vi.fn(async () => null)
    renderWithProviders(<CollectionPage />, {
      api: createMockApi({
        cards: { get },
        collection: { list: async () => [dm, bew] },
        favourites: { list: async () => [bew.card.id], set }
      })
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Favourite Dark Magician' }))
    expect(set).toHaveBeenCalledWith(dm.card.id, true)
    expect(screen.getByRole('button', { name: 'Unfavourite Dark Magician' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Unfavourite Blue-Eyes White Dragon' })
    ).toHaveAttribute('data-on', 'true')
    expect(get).not.toHaveBeenCalled()
  })

  it('undoes the heart, with a toast, when the write fails', async () => {
    renderWithProviders(<CollectionPage />, {
      api: createMockApi({
        collection: { list: async () => [dm] },
        favourites: {
          set: async () => {
            throw new Error('offline')
          }
        }
      })
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Favourite Dark Magician' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not update your favourites')
    )
    expect(screen.getByRole('button', { name: 'Favourite Dark Magician' })).toBeInTheDocument()
  })

  it('the table view has the heart on the name, and Enter on it opens nothing', async () => {
    localStorage.setItem('collection.view', 'table')
    const set = vi.fn(async () => undefined)
    const get = vi.fn(async () => null)
    renderWithProviders(<CollectionPage />, {
      api: createMockApi({
        cards: { get },
        collection: { list: async () => [dm] },
        favourites: { set }
      })
    })
    const heart = await screen.findByRole('button', { name: 'Favourite Dark Magician' })
    heart.focus()
    await userEvent.keyboard('{Enter}')
    expect(set).toHaveBeenCalledWith(dm.card.id, true)
    expect(get).not.toHaveBeenCalled()
  })

  it('the Favourites filter asks for favourites only, with a chip to remove it', async () => {
    stubWideWindow()
    const list = vi.fn(async () => [dm])
    renderWithProviders(<CollectionPage />, {
      api: createMockApi({ collection: { list } })
    })
    await userEvent.click(await screen.findByRole('button', { name: /^Filters/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Favourites only' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ favourites: true }))
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove Favourites filter' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ favourites: undefined }))
    )
  })

  it("a friend's collection has no hearts and no Favourites filter", async () => {
    stubWideWindow()
    const favourites = vi.fn(async () => [])
    renderWithProviders(<CollectionPage friend={bob} />, {
      api: createMockApi({
        friends: { collection: async () => [dm] },
        favourites: { list: favourites }
      })
    })
    expect(await screen.findByText('Dark Magician')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /favourite/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    expect(screen.queryByRole('button', { name: 'Favourites only' })).not.toBeInTheDocument()
    expect(favourites).not.toHaveBeenCalled()
  })

  it('Browse tiles have the heart, and Browse filters to favourites', async () => {
    stubWideWindow()
    const browse = vi.fn(async (f: BrowseFilters) => ({
      cards: [browseCard(1, 'Dark Magician')].slice(f.offset ?? 0),
      total: 1
    }))
    const set = vi.fn(async () => undefined)
    const get = vi.fn(async () => null)
    renderWithProviders(<BrowsePage onAddCard={() => {}} />, {
      api: createMockApi({ cards: { browse, get }, favourites: { set } })
    })
    const grid = await screen.findByRole('list', { name: 'All cards' })
    await userEvent.click(
      await within(grid).findByRole('button', { name: 'Favourite Dark Magician' })
    )
    expect(set).toHaveBeenCalledWith(1, true)
    expect(get).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Favourites only' }))
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ favourites: true }))
    )
  })
})
