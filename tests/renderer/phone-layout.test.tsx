import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  BrowseCard,
  CardDetail,
  CardRow,
  EntryView,
  Friend,
  Printing,
  SetSummary
} from '@shared/types'
import { OFFLINE_MESSAGE } from '@shared/friends'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { SetChecklist } from '@/features/sets/SetChecklist'
import { SetsPage } from '@/features/sets/SetsPage'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist, printingsOf } from './setFixtures'

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
  printingScan: true,
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

  it('collection keeps search on the page and the facets in a Filters sheet', async () => {
    renderWithProviders(<CollectionPage />, { api: phoneApi() })
    await screen.findByLabelText('Collection grid')
    // Search sits on the page itself, so opening the filters never raises the keyboard.
    expect(screen.getByRole('searchbox', { name: 'Search collection' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Card type' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    expect(sheet).toHaveAttribute('data-layout', 'bottom-sheet')
    expect(within(sheet).queryByRole('searchbox')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
    for (const facet of ['Card type', 'Attribute', 'Archetype', 'Set', 'Rarity']) {
      expect(within(sheet).getByRole('button', { name: facet })).toBeInTheDocument()
    }
    expect(within(sheet).getByRole('combobox', { name: 'Language' })).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Level min')).toBeInTheDocument()
    expect(within(sheet).getByRole('radio', { name: 'Date added' })).toBeChecked()
    expect(within(sheet).getByRole('button', { name: 'Sort descending' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    // Nothing in the sheet takes focus on opening.
    expect(sheet.contains(document.activeElement)).toBe(false)
  })

  it('collection shows a count and removable chips for active phone filters', async () => {
    renderWithProviders(<CollectionPage />, { api: phoneApi() })
    await screen.findByLabelText('Collection grid')
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Card type' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Normal Monster' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Normal Monster filter' }))
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove Normal Monster filter' })
    ).not.toBeInTheDocument()
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

  it('sets list is one column and its filters open as a bottom sheet on the phone', async () => {
    // A grid preference saved on a wide screen doesn't apply to the phone.
    localStorage.setItem('sets.view', 'grid')
    const summary: SetSummary = { ...metalRaidersChecklist.set }
    const api = phoneApi()
    api.sets.list = vi.fn(async () => [summary])
    renderWithProviders(<SetsPage onAddCard={() => {}} onAddMissing={() => {}} />, { api })
    expect(await screen.findByRole('button', { name: /Metal Raiders/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Sets' })).toHaveAttribute('data-view', 'list')
    expect(screen.queryByRole('radio', { name: 'Grid view' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filters & sort' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filters & sort' })
    expect(sheet).toHaveAttribute('data-layout', 'bottom-sheet')
    expect(within(sheet).getByRole('radio', { name: 'Started' })).toBeInTheDocument()
  })

  it('set card panel opens full-screen on the phone', async () => {
    const api = phoneApi()
    api.sets.checklist = vi.fn(async () => metalRaidersChecklist)
    api.collection.forCard = vi.fn(async () => [])
    api.cards.get = vi.fn(async () => ({ ...detail, printings: printingsOf(2001) }))
    renderWithProviders(
      <SetChecklist
        setName="Metal Raiders"
        language="en"
        mode="cards"
        onModeChange={() => {}}
        onBack={() => {}}
        onAddMissing={() => {}}
      />,
      { api }
    )
    await userEvent.click(await screen.findByRole('button', { name: /Beta Knight/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Beta Knight' })
    expect(sheet).toHaveAttribute('data-layout', 'full-screen')
    // The steppers come before the card text, so they're reachable without a long scroll.
    const plus = await within(sheet).findByRole('button', {
      name: 'Add one Beta Knight MRD-002 Common'
    })
    const text = await within(sheet).findByText('A wizard.')
    expect(plus.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('set checklist keeps bulk add and the count mode in a menu on the phone', async () => {
    const api = phoneApi()
    api.sets.checklist = vi.fn(async () => metalRaidersChecklist)
    const onModeChange = vi.fn()
    renderWithProviders(
      <SetChecklist
        setName="Metal Raiders"
        language="en"
        mode="cards"
        onModeChange={onModeChange}
        onBack={() => {}}
        onAddMissing={() => {}}
      />,
      { api }
    )
    await screen.findByRole('button', { name: /Alpha Dragon/ })
    expect(screen.queryByRole('button', { name: 'Bulk add' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Every rarity' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More tools' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Every rarity' }))
    expect(onModeChange).toHaveBeenCalledWith('rarities')
    await userEvent.click(screen.getByRole('button', { name: 'More tools' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Bulk add' }))
    expect(await screen.findByLabelText('Type a card number or name')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByLabelText('Type a card number or name')).not.toBeInTheDocument()
  })

  it('browse filters open as a sheet on the phone', async () => {
    const result: BrowseCard = {
      id: 101,
      name: 'Dark Magician',
      type: 'Normal Monster',
      frameType: 'normal',
      attribute: 'DARK',
      race: 'Spellcaster',
      level: 7,
      linkval: null,
      atk: 2500,
      def: 2100,
      imageId: 101,
      price: 7.5,
      releasedAt: '2002-03-08',
      owned: 0,
      defaultPrintingId: 1
    }
    const api = phoneApi()
    api.cards.browse = vi.fn(async () => ({ cards: [result], total: 1 }))
    renderWithProviders(<BrowsePage onAddCard={() => {}} />, { api })
    await screen.findByRole('button', { name: /Dark Magician/ })
    // Search stays on the page; the facets wait behind one Filters button.
    expect(screen.getByRole('searchbox', { name: 'Search cards' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Card type/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filters' })
    expect(sheet).toHaveAttribute('data-layout', 'bottom-sheet')
    expect(within(sheet).getByRole('button', { name: /Card type/ })).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Level min')).toBeInTheDocument()
    // Nothing in the sheet takes focus on opening.
    expect(sheet.contains(document.activeElement)).toBe(false)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Card details open full-screen.
    await userEvent.click(screen.getByRole('button', { name: /Dark Magician/ }))
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-layout', 'full-screen')
  })

  it('friend entry opens full-screen on the phone', async () => {
    const bob: Friend = {
      id: 7,
      username: 'bob',
      displayName: 'Bob',
      avatarUrl: null,
      cardCount: 2,
      updatedAt: null
    }
    const api = phoneApi()
    api.friends.overview = vi.fn(async () => ({ friends: [bob], incoming: [], blocked: [] }))
    api.friends.collection = vi.fn(async () => [dm])
    renderWithProviders(<FriendsPage />, { api })
    // The friend list comes before the add-friend form.
    const pick = await screen.findByRole('button', { name: /Bob/ })
    const add = screen.getByRole('textbox', { name: 'Username' })
    expect(pick.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(pick)
    await userEvent.click(await screen.findByRole('radio', { name: 'Collection' }))
    expect(await screen.findByLabelText('Collection grid')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /Dark Magician/ }))
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveAttribute('data-layout', 'full-screen')
    expect(within(sheet).getByRole('region', { name: 'Their copies' })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // A way back to the friend list.
    await userEvent.click(screen.getByRole('button', { name: 'All friends' }))
    expect(await screen.findByRole('button', { name: /Bob/ })).toBeInTheDocument()
  })

  it('friends shows the existing offline message on the phone', async () => {
    const api = phoneApi()
    api.friends.overview = vi.fn(async () => {
      throw new Error(OFFLINE_MESSAGE)
    })
    renderWithProviders(<FriendsPage />, { api })
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE_MESSAGE)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
