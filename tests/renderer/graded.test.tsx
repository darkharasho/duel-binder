import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GradedCopy } from '@shared/graded'
import type { CardRow, Printing } from '@shared/types'
import { GradedCopies } from '@/features/graded/GradedCopies'
import { GradedPage } from '@/features/graded/GradedPage'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))
vi.mock('@/features/graded/qrDecode', () => ({
  decodeQr: vi.fn(async () => 'https://tagd.co/Y1267951')
}))

const card = (id: number, name: string): CardRow => ({
  id,
  name,
  type: 'Normal Monster',
  frameType: 'normal',
  race: 'Dragon',
  attribute: 'LIGHT',
  level: 8,
  linkval: null,
  atk: 3000,
  def: 2500,
  archetype: null,
  desc: 'A dragon.',
  tcgplayerPrice: 1
})
const printing = (id: number, cardId: number, setCode = `LOB-EN00${id}`): Printing => ({
  id,
  cardId,
  setName: 'Legend of Blue Eyes',
  setCode,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: 10,
  missingFromApi: false
})
const slab = (uid: string, patch: Partial<GradedCopy> = {}): GradedCopy => ({
  uid,
  game: 'ygo',
  pkey: `pk-${uid}`,
  card: card(1, 'Blue-Eyes White Dragon'),
  printing: printing(11, 1),
  imageId: 5,
  printingScan: true,
  company: 'PSA',
  grade: '10',
  label: '',
  cert: '84512277',
  subgrades: '',
  value: 500,
  paid: 200,
  notes: '',
  rawPrice: 40,
  market: null,
  createdAt: '2026-11-01T00:00:00Z',
  ...patch
})

describe('GradedCopies (card panel)', () => {
  it('adds a graded copy on the printing shown', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => 'new-uid')
    const { api } = renderWithProviders(
      <GradedCopies
        cardId={1}
        cardName="Blue-Eyes White Dragon"
        printings={[printing(11, 1), printing(12, 1)]}
        printingId={12}
      />,
      { api: createMockApi({ graded: { save } }) }
    )
    await user.click(screen.getByRole('button', { name: 'Add graded copy' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(/Doesn't count toward set or binder progress/)
    ).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Cert number'), ' 123 ')
    await user.type(within(dialog).getByLabelText('Value (USD)'), '$1,250.50')
    await user.click(within(dialog).getByRole('button', { name: 'Add graded copy' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        printingId: 12,
        company: 'PSA',
        grade: '10',
        label: '',
        cert: '123',
        subgrades: '',
        value: 1250.5,
        paid: null,
        notes: ''
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.graded.forCard).toHaveBeenCalledWith(1)
  })

  it('fills in the grader and cert from a photo of the label’s QR code', async () => {
    const user = userEvent.setup()
    // No camera here: the photo is the way in.
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => Promise.reject(new Error('NotFoundError'))) }
    })
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() }))
    )
    renderWithProviders(
      <GradedCopies cardId={1} cardName="X" printings={[printing(11, 1)]} printingId={11} />
    )
    await user.click(screen.getByRole('button', { name: 'Add graded copy' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('link', { name: /report/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: "Scan the label's QR code" }))
    const scan = await screen.findByRole('dialog', { name: 'Scan the label’s QR code' })
    expect(await within(scan).findByText(/No camera to use/)).toBeInTheDocument()
    const photo = new File(['x'], 'label.jpg', { type: 'image/jpeg' })
    await user.upload(scan.querySelector('input[type=file]') as HTMLInputElement, photo)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Scan the label’s QR code' })).toBeNull()
    )
    const form = screen.getByRole('dialog')
    expect(within(form).getByLabelText('Cert number')).toHaveValue('Y1267951')
    expect(within(form).getByRole('combobox', { name: 'Grading company' })).toHaveTextContent('TAG')
    expect(within(form).getByRole('link', { name: 'View TAG report' })).toHaveAttribute(
      'href',
      'https://tagd.co/Y1267951'
    )
    vi.unstubAllGlobals()
  })

  it('offers Beckett subgrades, all four or none', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => 'new-uid')
    renderWithProviders(
      <GradedCopies cardId={1} cardName="X" printings={[printing(11, 1)]} printingId={11} />,
      { api: createMockApi({ graded: { save } }) }
    )
    await user.click(screen.getByRole('button', { name: 'Add graded copy' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Centering subgrade')).not.toBeInTheDocument()
    await user.click(within(dialog).getByLabelText('Grading company'))
    await user.click(await screen.findByRole('option', { name: 'BGS' }))
    const pick = async (name: string, value: string): Promise<void> => {
      await user.click(within(dialog).getByLabelText(`${name} subgrade`))
      await user.click(await screen.findByRole('option', { name: value }))
    }
    await pick('Centering', '9.5')
    const add = within(dialog).getByRole('button', { name: 'Add graded copy' })
    expect(add).toBeDisabled()
    expect(within(dialog).getByText('Pick all four subgrades, or none.')).toBeInTheDocument()
    await pick('Corners', '10')
    await pick('Edges', '10')
    await pick('Surface', '9')
    await user.click(add)
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'BGS', subgrades: '9.5 10 10 9' })
      )
    )
  })

  it('draws each grader’s own slab, and a plain one for others', async () => {
    renderWithProviders(<GradedPage />, {
      api: createMockApi({
        graded: {
          list: async () =>
            ['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'ARS'].map((company, i) =>
              slab(String(i), { company, subgrades: company === 'BGS' ? '10 10 10 10' : '' })
            )
        }
      })
    })
    await screen.findAllByTestId('slab')
    expect(screen.getAllByTestId('slab').map((el) => el.dataset.grader)).toEqual(
      expect.arrayContaining(['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE', 'plain'])
    )
    expect(screen.getByText('Centering')).toBeInTheDocument()
    expect(screen.getAllByText('GEM MT').length).toBeGreaterThan(0)
  })

  it('blocks a bad dollar amount', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <GradedCopies cardId={1} cardName="X" printings={[printing(11, 1)]} printingId={11} />
    )
    await user.click(screen.getByRole('button', { name: 'Add graded copy' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Price paid (USD)'), 'abc')
    expect(within(dialog).getByRole('button', { name: 'Add graded copy' })).toBeDisabled()
  })

  it('lists the card’s slabs, edits one and removes it', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => 'a')
    const remove = vi.fn(async () => undefined)
    renderWithProviders(
      <GradedCopies
        cardId={1}
        cardName="Blue-Eyes"
        printings={[printing(11, 1)]}
        printingId={11}
      />,
      {
        api: createMockApi({
          graded: {
            forCard: async () => [
              slab('a', { company: 'BGS', grade: '9.5', label: 'Black Label' }),
              slab('b', { value: null })
            ],
            save,
            remove
          }
        })
      }
    )
    expect(await screen.findByText('BGS 9.5 Black Label')).toBeInTheDocument()
    // No value entered: the raw price shows, marked.
    expect(screen.getByText('$40.00 raw')).toBeInTheDocument()
    expect(screen.getAllByTestId('slab')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /BGS 9.5 Black Label LOB-EN0011, edit/ }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Label (optional)')).toHaveValue('Black Label')
    const notes = within(dialog).getByLabelText('Notes')
    await user.type(notes, 'centered')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 'a', printingId: 11, imageId: 5, notes: 'centered' })
      )
    )

    await user.click(screen.getByRole('button', { name: /BGS 9.5 Black Label LOB-EN0011, edit/ }))
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('a'))
  })
})

describe('GradedPage', () => {
  it('counts eBay’s price for a slab with no value entered, marked as eBay’s', async () => {
    const market = { price: 410, listings: 5, checkedAt: '2026-11-19T00:00:00Z' }
    renderWithProviders(<GradedPage />, {
      api: createMockApi({
        graded: {
          list: async () => [
            slab('a', { value: 100 }),
            slab('b', { value: null, market, card: card(2, 'Dark Magician') })
          ]
        }
      })
    })
    expect(await screen.findByText('$510.00')).toBeInTheDocument()
    expect(screen.getByText('$410.00')).toHaveTextContent('$410.00')
    expect(screen.getByTitle(/median of 5 eBay listings of a PSA 10/)).toHaveTextContent(
      '$410.00 eBay'
    )
    expect(screen.queryByText(/without a value/)).not.toBeInTheDocument()
  })

  it('shows totals and sorts slabs by grade', async () => {
    const user = userEvent.setup()
    renderWithProviders(<GradedPage />, {
      api: createMockApi({
        graded: {
          list: async () => [
            slab('a', { grade: '8', value: 100, paid: 50 }),
            slab('b', { grade: 'Authentic', value: null, paid: null }),
            slab('c', { grade: '10', value: 900, paid: 300, card: card(2, 'Dark Magician') })
          ]
        }
      })
    })
    expect(await screen.findByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByText('$350.00')).toBeInTheDocument()
    expect(screen.getByText('1 without a value or eBay price')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Grade' }))
    const names = screen
      .getAllByRole('button', { name: /, (PSA)/ })
      .map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual([
      'Dark Magician, PSA 10',
      'Blue-Eyes White Dragon, PSA 8',
      'Blue-Eyes White Dragon, PSA Authentic'
    ])

    await user.type(screen.getByRole('searchbox', { name: 'Search graded cards' }), 'dark')
    await waitFor(() => expect(screen.getAllByTestId('slab')).toHaveLength(1))
  })

  it('shows how to start with no slabs', async () => {
    renderWithProviders(<GradedPage />)
    expect(await screen.findByText('No graded cards yet')).toBeInTheDocument()
  })
})
