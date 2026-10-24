import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { CardDetail, CardRow, CardSearchResult, Printing } from '@shared/types'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const row = (id: number, name: string, type: string): CardRow => ({
  id,
  name,
  type,
  frameType: 'normal',
  race: 'Spellcaster',
  attribute: null,
  level: null,
  linkval: null,
  atk: null,
  def: null,
  archetype: null,
  desc: '',
  tcgplayerPrice: 1
})
const printing = (
  id: number,
  cardId: number,
  setCode: string,
  extra: Partial<Printing> = {}
): Printing => ({
  id,
  cardId,
  setName: 'Legend of Blue Eyes White Dragon',
  setCode,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  setPrice: 12.5,
  missingFromApi: false,
  ...extra
})

const pot: CardSearchResult = {
  id: 55144522,
  name: 'Pot of Greed',
  type: 'Spell Card',
  defaultImageId: 55144522,
  matchedSetCode: null
}
const dm: CardSearchResult = {
  id: 46986415,
  name: 'Dark Magician',
  type: 'Normal Monster',
  defaultImageId: 46986413,
  matchedSetCode: null
}
const details: Record<number, CardDetail> = {
  [pot.id]: {
    card: row(pot.id, pot.name, pot.type),
    printings: [
      printing(1, pot.id, 'LOB-EN119'),
      printing(2, pot.id, 'XXX-EN000', { setName: 'Hidden Set', missingFromApi: true })
    ],
    images: [{ imageId: 55144522, cardId: pot.id, sortOrder: 0 }]
  },
  [dm.id]: {
    card: row(dm.id, dm.name, dm.type),
    printings: [printing(3, dm.id, 'LOB-EN005')],
    images: [
      { imageId: 46986413, cardId: dm.id, sortOrder: 0 },
      { imageId: 46986415, cardId: dm.id, sortOrder: 1 }
    ]
  }
}

function setup(overrides: Parameters<typeof createMockApi>[0] = {}): {
  add: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
} {
  const add = vi.fn(async () => ({}) as never)
  const get = vi.fn(async (id: number) => details[id] ?? null)
  const api = createMockApi({
    cards: {
      search: async (q: string) =>
        q.toLowerCase().startsWith('pot') ? [pot] : q.toLowerCase().startsWith('dark') ? [dm] : [],
      get
    },
    collection: { add },
    ...overrides
  })
  const utils = renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />, { api })
  return { add, get, ...utils }
}

describe('AddCardDialog', () => {
  beforeEach(() => vi.mocked(toast.success).mockClear())

  it('single-art card skips art step', async () => {
    const { add } = setup()
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'pot')
    await userEvent.click(await screen.findByText('Pot of Greed'))
    expect(screen.queryByText('Hidden Set')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByText('LOB-EN119'))
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    const qty = screen.getByLabelText('Quantity')
    await userEvent.clear(qty)
    await userEvent.type(qty, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ printingId: 1, imageId: 55144522, quantity: 3 })
    )
    expect(toast.success).toHaveBeenCalledWith('Added 3 × Pot of Greed (LOB-EN119)')
  })

  it('multi-art card shows art step with original preselected', async () => {
    const { add } = setup()
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'dark')
    await userEvent.click(await screen.findByText('Dark Magician'))
    await userEvent.click(await screen.findByText('LOB-EN005'))
    const arts = await screen.findAllByRole('radio')
    expect(arts).toHaveLength(2)
    expect(arts[0]).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(arts[1])
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ printingId: 3, imageId: 46986415, quantity: 1 })
    )
  })

  it('printing list falls back to the card price (approximate) when the set price is missing', async () => {
    setup({
      cards: {
        search: async () => [pot],
        get: async () => ({
          card: row(pot.id, pot.name, pot.type),
          printings: [printing(1, pot.id, 'LOB-EN119', { setPrice: null })],
          images: [{ imageId: 55144522, cardId: pot.id, sortOrder: 0 }]
        })
      }
    })
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'pot')
    await userEvent.click(await screen.findByText('Pot of Greed'))
    await screen.findByText('LOB-EN119')
    expect(screen.getByText('≈')).toBeInTheDocument()
    expect(screen.getByText('$1.00')).toBeInTheDocument()
  })

  it('Space on an art radio selects it without advancing', async () => {
    setup()
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'dark')
    await userEvent.click(await screen.findByText('Dark Magician'))
    await userEvent.click(await screen.findByText('LOB-EN005'))
    const arts = await screen.findAllByRole('radio')
    await waitFor(() => expect(arts[0]).toHaveFocus())
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard(' ')
    expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument()
  })

  it('quantity 0 disables Save', async () => {
    setup()
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'pot')
    await userEvent.click(await screen.findByText('Pot of Greed'))
    await userEvent.click(await screen.findByText('LOB-EN119'))
    const qty = screen.getByLabelText('Quantity')
    await userEvent.clear(qty)
    await userEvent.type(qty, '0')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.clear(qty)
    await userEvent.type(qty, '2')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('stays open and resets after save', async () => {
    setup()
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'pot')
    await userEvent.click(await screen.findByText('Pot of Greed'))
    await userEvent.click(await screen.findByText('LOB-EN119'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const search = await screen.findByPlaceholderText(/Search cards/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(search).toHaveValue('')
    await waitFor(() => expect(search).toHaveFocus())
  })

  it('Backspace on an empty step goes back', async () => {
    setup()
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'pot')
    await userEvent.click(await screen.findByText('Pot of Greed'))
    await screen.findByText('LOB-EN119')
    await userEvent.keyboard('{Backspace}')
    expect(await screen.findByPlaceholderText(/Search cards/)).toBeInTheDocument()
  })

  it('ignores auto-repeated Backspace so holding it does not cascade back', async () => {
    setup()
    await userEvent.type(await screen.findByPlaceholderText(/Search cards/), 'pot')
    await userEvent.click(await screen.findByText('Pot of Greed'))
    const filter = await screen.findByPlaceholderText(/Filter printings/)
    fireEvent.keyDown(filter, { key: 'Backspace', repeat: true })
    expect(screen.getByPlaceholderText(/Filter printings/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Search cards/)).not.toBeInTheDocument()
  })

  it('does not select stale results when Enter is pressed before the debounce settles', async () => {
    const { get } = setup()
    const input = await screen.findByPlaceholderText(/Search cards/)
    await userEvent.type(input, 'pot')
    await screen.findByText('Pot of Greed')
    await userEvent.type(input, 'x')
    await userEvent.keyboard('{Enter}')
    expect(get).not.toHaveBeenCalled()
    expect(screen.queryByText('Pot of Greed')).not.toBeInTheDocument()
  })

  it('shows downloading message when card db empty', async () => {
    setup({
      sync: {
        status: async () => ({
          state: 'downloading',
          lastSyncAt: null,
          dbVersion: null,
          cardCount: 0,
          error: null
        })
      }
    })
    expect(await screen.findByText('Card database is still downloading')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Search cards/)).not.toBeInTheDocument()
  })

  it('opens at the printing step with the initial printing highlighted', async () => {
    const api = createMockApi({
      cards: { search: async () => [], get: async (id: number) => details[id] ?? null }
    })
    renderWithProviders(
      <AddCardDialog open onOpenChange={() => {}} initial={{ card: dm, printingId: 3 }} />,
      { api }
    )
    const item = await screen.findByRole('option', { name: /LOB-EN005/ })
    await waitFor(() => expect(item).toHaveAttribute('aria-selected', 'true'))
    await userEvent.keyboard('{Enter}')
    expect(await screen.findAllByRole('radio')).toHaveLength(2)
  })
})
