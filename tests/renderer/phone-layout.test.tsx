import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardDetail, CardRow, EntryView, Printing } from '@shared/types'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const card: CardRow = {
  id: 101,
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
  desc: 'A wizard.',
  tcgplayerPrice: 1
}
const printing: Printing = {
  id: 1,
  cardId: 101,
  setName: 'Legend of Blue Eyes',
  setCode: 'LOB-EN005',
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 10,
  missingFromApi: false
}
const dm: EntryView = {
  id: 1,
  quantity: 2,
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  card,
  printing,
  imageId: 101,
  originalArt: true,
  unitPrice: 10,
  priceApproximate: false,
  priceSource: 'ygoprodeck',
  priceCheckedAt: null,
  priceListingCount: null,
  noPriceReason: null,
  totalValue: 20
}
const detail: CardDetail = {
  card,
  printings: [printing],
  images: [{ imageId: 101, cardId: 101, sortOrder: 0 }]
}

/** The mock api, reporting itself as the phone app. */
function phoneApi(): ReturnType<typeof createMockApi> {
  return createMockApi({
    window: { platform: 'phone' },
    cards: { get: async () => detail },
    collection: {
      list: async () => [dm],
      facets: async () => ({
        cardTypes: ['Normal Monster'],
        attributes: ['DARK'],
        archetypes: [],
        setNames: [],
        rarities: ['Ultra Rare'],
        languages: ['en']
      }),
      forCard: async () => [dm]
    }
  })
}

describe('phone layout', () => {
  beforeEach(() => localStorage.clear())

  it('collection opens an entry in a full-screen sheet with a back button', async () => {
    renderWithProviders(<CollectionPage />, { api: phoneApi() })
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveAttribute('data-layout', 'full-screen')
    // Quantity editing works there as on desktop.
    expect(await within(sheet).findByLabelText('Quantity')).toHaveValue(2)
    expect(within(sheet).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('collection hides the table view toggle on the phone', async () => {
    // A table preference saved on a wide screen doesn't apply to the phone.
    localStorage.setItem('collection.view', 'table')
    renderWithProviders(<CollectionPage />, { api: phoneApi() })
    expect(await screen.findByLabelText('Collection grid')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Table view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Grid view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('collection filters open from one Filters button as a bottom sheet', async () => {
    renderWithProviders(<CollectionPage />, { api: phoneApi() })
    await screen.findByLabelText('Collection grid')
    expect(screen.queryByRole('button', { name: 'Card type' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    expect(within(sheet).getByRole('searchbox', { name: 'Search collection' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /Card type/ })).toBeInTheDocument()
  })

  it('add card dialog is full-screen on the phone', async () => {
    renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />, { api: phoneApi() })
    const dialog = await screen.findByRole('dialog', { name: 'Add card' })
    expect(dialog).toHaveAttribute('data-layout', 'full-screen')
    expect(
      within(dialog).getByPlaceholderText('Search cards by name or set code…')
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('desktop keeps the side sheet, the view toggle and the centred dialog', async () => {
    const api = phoneApi()
    api.window.platform = 'linux'
    const view = renderWithProviders(<CollectionPage />, { api })
    expect(await screen.findByRole('radio', { name: 'Table view' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    expect(await screen.findByRole('dialog')).not.toHaveAttribute('data-layout')
    view.unmount()
    renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />, { api })
    expect(await screen.findByRole('dialog', { name: 'Add card' })).not.toHaveAttribute(
      'data-layout'
    )
  })
})
