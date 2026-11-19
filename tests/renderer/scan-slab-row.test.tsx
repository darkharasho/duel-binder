import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScanRowItem, type ScanRowActions } from '@/features/scan/ScanRowItem'
import { slabPrintings } from '@/features/scan/SlabRowActions'
import type { ScanRow } from '@/features/scan/session'
import { createMockApi, renderWithProviders } from './mockApi'
import { printing } from './scanFakes'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const base = printing({
  printingId: 501,
  cardId: 7,
  name: 'Pikachu',
  setName: 'Base Set',
  setCode: 'BS',
  rarity: 'Common',
  language: 'en',
  imageIds: [70]
})
const holo = { ...base, printingId: 502, rarity: 'Holo Rare' }
// A reprint of its art in another set: a card of its own.
const reprint = { ...base, printingId: 601, cardId: 8, setName: 'Base Set 2', setCode: 'B2' }

const row = (o: Partial<ScanRow> = {}): ScanRow => ({
  key: 'k',
  quantity: 1,
  addedAt: 0,
  cardId: 7,
  name: 'Pikachu',
  imageId: 70,
  printingId: 502,
  setCode: 'BS',
  rarity: 'Holo Rare',
  options: [base, holo, reprint],
  flag: null,
  via: 'art',
  game: 'pkm',
  slab: true,
  ...o
})

const actions = (): ScanRowActions => ({
  setPrinting: vi.fn(),
  setQuantity: vi.fn(),
  setSlab: vi.fn(),
  takeOne: vi.fn(),
  remove: vi.fn()
})

describe('a scanned slab on the session list', () => {
  it('lists the row’s printings for the form, reprints too for Pokémon', () => {
    expect(slabPrintings(row()).map((p) => p.id)).toEqual([501, 502, 601])
    // Elsewhere only the row's own card's.
    expect(slabPrintings(row({ game: 'op' })).map((p) => p.id)).toEqual([501, 502])
  })

  it('adds the slab as a graded copy on the row’s printing, then takes it off the row', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => 'uid-1')
    const a = actions()
    renderWithProviders(<ScanRowItem row={row()} actions={a} language={null} scanned={1} />, {
      api: createMockApi({ graded: { save } })
    })
    expect(screen.getByText(/not added as a raw card/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add as slab' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add graded copy' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ printingId: 502, grade: '10' }))
    )
    await waitFor(() => expect(a.takeOne).toHaveBeenCalledWith('k'))
  })

  it('marks a wrongly spotted slab as not one', async () => {
    const user = userEvent.setup()
    const a = actions()
    renderWithProviders(<ScanRowItem row={row()} actions={a} language={null} scanned={1} />)
    await user.click(screen.getByRole('button', { name: 'Not a slab' }))
    expect(a.setSlab).toHaveBeenCalledWith('k', false)
  })

  it('shows nothing of this on a raw card', () => {
    renderWithProviders(
      <ScanRowItem row={row({ slab: undefined })} actions={actions()} language={null} scanned={1} />
    )
    expect(screen.queryByRole('button', { name: 'Add as slab' })).not.toBeInTheDocument()
  })
})
