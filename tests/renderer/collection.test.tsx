import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { CardDetail, CardRow, EntryView, Printing } from '@shared/types'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { createMockApi, renderWithProviders } from './mockApi'

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
const printing = (id: number, cardId: number, extra: Partial<Printing> = {}): Printing => ({
  id,
  cardId,
  setName: 'Legend of Blue Eyes',
  setCode: `LOB-EN00${id}`,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 10,
  missingFromApi: false,
  ...extra
})
const entry = (id: number, name: string, extra: Partial<EntryView> = {}): EntryView => ({
  id,
  quantity: 2,
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  card: card(100 + id, name),
  printing: printing(id, 100 + id),
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

const dm = entry(1, 'Dark Magician')
const bew = entry(2, 'Blue-Eyes White Dragon')

const dmDetail: CardDetail = {
  card: dm.card,
  printings: [dm.printing, printing(5, dm.card.id, { setRarity: 'Common', setCode: 'SDY-006' })],
  images: [
    { imageId: 101, cardId: dm.card.id, sortOrder: 0 },
    { imageId: 9001, cardId: dm.card.id, sortOrder: 1 }
  ]
}

function setup(
  entries: EntryView[] = [dm, bew],
  overrides: Parameters<typeof createMockApi>[0] = {},
  props: Parameters<typeof CollectionPage>[0] = {}
): ReturnType<typeof renderWithProviders> & { list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async () => entries)
  const api = createMockApi({
    cards: {
      get: async (id: number) =>
        id === dm.card.id
          ? dmDetail
          : { card: entries.find((e) => e.card.id === id)!.card, printings: [], images: [] }
    },
    ...overrides,
    collection: {
      list,
      facets: async () => ({
        cardTypes: ['Normal Monster'],
        attributes: ['DARK'],
        archetypes: [],
        setNames: [],
        rarities: ['Ultra Rare', 'Common'],
        languages: ['en', 'ja']
      }),
      forCard: async (id: number) => entries.filter((e) => e.card.id === id),
      ...overrides.collection
    }
  })
  api.collection.list = list
  return { list, ...renderWithProviders(<CollectionPage {...props} />, { api }) }
}

describe('CollectionPage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(toast.success).mockClear()
  })

  it('renders entries in grid and table', async () => {
    setup()
    expect(await screen.findByText('Dark Magician')).toBeInTheDocument()
    expect(screen.getByLabelText('Collection grid')).toBeInTheDocument()
    expect(screen.getByText(/2 entries · Prices updated never/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Table view' }))
    expect(await screen.findByRole('columnheader', { name: 'Unit price' })).toBeInTheDocument()
    expect(screen.getByText('Blue-Eyes White Dragon')).toBeInTheDocument()
    expect(localStorage.getItem('collection.view')).toBe('table')
  })

  it('sends the shared language filter (English by default) and All languages clears it', async () => {
    const { list } = setup()
    await screen.findByText('Dark Magician')
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'en' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Language' }))
    await userEvent.click(await screen.findByRole('option', { name: 'All languages' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ language: undefined }))
    )
  })

  it('offers Show all languages when only other-language cards are owned', async () => {
    const stats = {
      totalCards: 2,
      uniqueCards: 1,
      totalValue: 0,
      approximateCount: 0,
      byRarity: [],
      byFrameType: [],
      topEntries: [],
      pricesUpdatedAt: null
    }
    // The English-filtered list is empty because the only owned entry is Japanese.
    const { list } = setup([], { stats: { get: async () => stats } })
    expect(await screen.findByText('No English cards')).toBeInTheDocument()
    expect(screen.queryByText('No cards yet')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all languages' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ language: undefined }))
    )
  })

  it('shows a language tag on non-English rows', async () => {
    const ja = entry(3, 'Red-Eyes', {
      printing: printing(3, 103, { language: 'ja', setCode: 'LB-05' })
    })
    setup([ja])
    expect(await screen.findByText('JP')).toBeInTheDocument()
  })

  it('changing rarity facet calls list with rarities', async () => {
    const { list } = setup()
    await screen.findByText('Dark Magician')
    await userEvent.click(screen.getByRole('button', { name: 'Rarity' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Ultra Rare' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ rarities: ['Ultra Rare'] }))
    )
  })

  it('sort by value desc calls list with { sort: value, dir: desc }', async () => {
    localStorage.setItem('collection.view', 'table')
    const { list } = setup()
    await screen.findByText('Dark Magician')
    await userEvent.click(screen.getByRole('button', { name: 'Total' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'value', dir: 'desc' }))
    )
  })

  it('sort select and direction toggle drive the same state', async () => {
    const { list } = setup()
    await screen.findByText('Dark Magician')
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort by' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Value' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sort descending' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'value', dir: 'asc' }))
    )
  })

  it('approximate value shows ≈', async () => {
    setup([entry(1, 'Dark Magician', { priceApproximate: true })])
    expect(await screen.findByText('≈')).toBeInTheDocument()
  })

  it('unpriced entries show an em dash instead of $0.00', async () => {
    setup([entry(1, 'Dark Magician', { unitPrice: null, totalValue: 0, priceApproximate: true })])
    await screen.findByText('Dark Magician')
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.queryByText('≈')).not.toBeInTheDocument()
  })

  it('missing printing shows stale badge', async () => {
    setup([entry(1, 'Dark Magician', { printing: printing(1, 101, { missingFromApi: true }) })])
    expect(
      await screen.findByText('No longer in database — price may be stale')
    ).toBeInTheDocument()
  })

  it('editing quantity calls update', async () => {
    const update = vi.fn(async () => ({ ...dm, quantity: 5 }))
    setup([dm, bew], { collection: { update } })
    await userEvent.click(await screen.findByText('Dark Magician'))
    const qty = await screen.findByLabelText('Quantity')
    await userEvent.clear(qty)
    await userEvent.type(qty, '5')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { quantity: 5 }))
  })

  it('merge result reselects returned entry and toasts', async () => {
    const other = entry(9, 'Dark Magician', { card: dm.card, imageId: 9001, quantity: 4 })
    const update = vi.fn(async () => other)
    setup([dm, other], { collection: { update } })
    await userEvent.click((await screen.findAllByText('Dark Magician'))[0])
    await userEvent.click(await screen.findByRole('radio', { name: 'Artwork 2' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { imageId: 9001 }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Merged with an existing entry'))
    const copies = await screen.findByRole('region', { name: 'Your copies' })
    await waitFor(() =>
      expect(within(copies).getByRole('button', { name: /×4/ })).toHaveAttribute(
        'aria-current',
        'true'
      )
    )
  })

  it('remove asks for confirmation then calls remove', async () => {
    const remove = vi.fn(async () => undefined)
    setup([dm, bew], { collection: { remove } })
    await userEvent.click(await screen.findByText('Dark Magician'))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens the detail panel for initialEntryId', async () => {
    setup([dm, bew], {}, { initialEntryId: 2 })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      await within(screen.getByRole('dialog')).findByText('Blue-Eyes White Dragon')
    ).toBeInTheDocument()
  })

  it('detail panel shows the eBay asking-price line for a priced non-English copy', async () => {
    const ja = entry(3, 'Red-Eyes', {
      printing: printing(3, 103, { language: 'ja', setCode: 'LB-05' }),
      unitPrice: 12.5,
      totalValue: 25,
      priceSource: 'ebay',
      priceCheckedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      priceListingCount: 32
    })
    setup([ja], {}, { initialEntryId: 3 })
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('eBay asking price · checked 3 days ago · 32 listings')
    ).toBeInTheDocument()
  })

  it('detail panel shows the no-price reason for an unpriced non-English copy', async () => {
    const ja = entry(3, 'Red-Eyes', {
      printing: printing(3, 103, { language: 'ja', setCode: 'LB-05' }),
      unitPrice: null,
      totalValue: 0,
      priceSource: 'ebay',
      priceCheckedAt: '2026-10-20T00:00:00.000Z',
      priceListingCount: 0,
      noPriceReason: 'no-listings'
    })
    setup([ja], {}, { initialEntryId: 3 })
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('No eBay listings found')).toBeInTheDocument()
  })

  it('detail panel shows no eBay line for an English copy', async () => {
    setup([dm, bew], {}, { initialEntryId: 1 })
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Value')
    expect(within(dialog).queryByText(/eBay/)).not.toBeInTheDocument()
  })

  it('keeps the panel open when a filter excludes the initial entry', async () => {
    const { list } = setup([dm, bew], {}, { initialEntryId: 2 })
    expect(
      await within(await screen.findByRole('dialog')).findByText('Blue-Eyes White Dragon')
    ).toBeInTheDocument()
    list.mockImplementation(async () => [dm])
    fireEvent.change(screen.getByLabelText('Level min'), { target: { value: '3' } })
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ levelMin: 3 }))
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  describe('previous / next card arrows', () => {
    const rek = entry(3, 'Red-Eyes Black Dragon')
    const arrow = (name: 'Previous card' | 'Next card'): HTMLElement =>
      screen.getAllByRole('button', { name })[0]
    const title = (name: string): Promise<HTMLElement> =>
      within(screen.getByRole('dialog')).findByRole('heading', { name })

    it('step through entries in the displayed order, disabled at the ends', async () => {
      setup([bew, dm, rek])
      await userEvent.click(await screen.findByText('Blue-Eyes White Dragon'))
      const dialog = await screen.findByRole('dialog')
      await title('Blue-Eyes White Dragon')
      expect(arrow('Previous card')).toBeDisabled()

      await userEvent.click(arrow('Next card'))
      await title('Dark Magician')
      expect(
        screen.getByRole('button', { name: /Dark Magician/, pressed: true, hidden: true })
      ).toBeInTheDocument()
      await userEvent.click(arrow('Next card'))
      await title('Red-Eyes Black Dragon')
      expect(arrow('Next card')).toBeDisabled()
      await userEvent.click(arrow('Previous card'))
      await title('Dark Magician')
      // The same sheet stays open throughout.
      expect(screen.getByRole('dialog')).toBe(dialog)
    })

    it('ArrowRight steps, but not while typing in a field', async () => {
      setup([bew, dm])
      await userEvent.click(await screen.findByText('Blue-Eyes White Dragon'))
      const notes = await screen.findByLabelText('Notes')
      await userEvent.click(notes)
      await userEvent.keyboard('{ArrowRight}')
      await new Promise((r) => setTimeout(r, 20))
      expect(
        within(screen.getByRole('dialog')).getByRole('heading', { name: 'Blue-Eyes White Dragon' })
      ).toBeInTheDocument()

      fireEvent.keyDown(screen.getByRole('heading', { name: 'Blue-Eyes White Dragon' }), {
        key: 'ArrowRight'
      })
      await title('Dark Magician')
    })
  })

  it('empty and no-match states', async () => {
    const onAddCard = vi.fn()
    const { unmount } = setup([], {}, { onAddCard })
    expect(await screen.findByText('No cards yet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add card' }))
    expect(onAddCard).toHaveBeenCalled()
    unmount()

    const { list } = setup([])
    await screen.findByText('No cards yet')
    await userEvent.type(screen.getByLabelText('Search collection'), 'zzz')
    expect(await screen.findByText('No cards match these filters')).toBeInTheDocument()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'zzz' }))
    await userEvent.click(
      within(screen.getByText('No cards match these filters').parentElement!).getByRole('button', {
        name: 'Clear filters'
      })
    )
    expect(await screen.findByText('No cards yet')).toBeInTheDocument()
  })
})
