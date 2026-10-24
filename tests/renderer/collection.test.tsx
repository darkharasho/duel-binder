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
  unitPrice: 10,
  priceApproximate: false,
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
        rarities: ['Ultra Rare', 'Common']
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
