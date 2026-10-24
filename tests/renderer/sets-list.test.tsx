import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SetSummary } from '@shared/types'
import { SetsPage } from '@/features/sets/SetsPage'
import { SetArt } from '@/features/sets/SetArt'
import { createMockApi, renderWithProviders } from './mockApi'

const set = (o: Partial<SetSummary>): SetSummary => ({
  setName: 'Set',
  setCode: 'SET',
  tcgDate: '2002-06-26',
  imageKey: 'SET',
  totalCards: 1,
  ownedCards: 0,
  totalRarities: 1,
  ownedRarities: 0,
  ...o
})

const MR = set({
  setName: 'Metal Raiders',
  setCode: 'MRD',
  tcgDate: '2002-06-26',
  totalCards: 3,
  ownedCards: 1,
  totalRarities: 4,
  ownedRarities: 1
})
const SD = set({
  setName: 'Starter Deck',
  setCode: 'SDY',
  tcgDate: '2002-03-08',
  totalCards: 1,
  ownedCards: 1,
  totalRarities: 1,
  ownedRarities: 1
})
const LOB = set({
  setName: 'Legend of Blue Eyes White Dragon',
  setCode: 'LOB',
  tcgDate: '2002-03-08',
  totalCards: 126,
  totalRarities: 126
})

function renderPage(
  sets: SetSummary[] = [MR, SD, LOB],
  onAddCard: () => void = () => {}
): ReturnType<typeof renderWithProviders> {
  const api = createMockApi({ sets: { list: async () => sets } })
  return renderWithProviders(<SetsPage onAddCard={onAddCard} onAddMissing={() => {}} />, { api })
}

beforeEach(() => localStorage.clear())

describe('SetsPage', () => {
  it('shows the header summary and hides unstarted sets until All sets', async () => {
    renderPage()
    expect(await screen.findByText("You've started 2 of 3 sets · 1 complete")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Legend of Blue Eyes/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'All sets' }))
    const lob = screen.getByRole('button', { name: /Legend of Blue Eyes/ })
    expect(lob).toHaveAttribute('data-started', 'false')
  })

  it('marks complete sets', async () => {
    renderPage()
    const sd = await screen.findByRole('button', { name: /Starter Deck/ })
    expect(within(sd).getByText('✓ Complete')).toBeInTheDocument()
    expect(within(sd).getByText('1 / 1')).toBeInTheDocument()
  })

  it('count mode changes progress and persists', async () => {
    renderPage()
    const mr = await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(within(mr).getByText('1 / 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Every rarity' }))
    expect(
      within(screen.getByRole('button', { name: /Metal Raiders/ })).getByText('1 / 4')
    ).toBeInTheDocument()
    expect(localStorage.getItem('sets.countMode')).toBe('rarities')
  })

  it('search filters by code', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await userEvent.type(screen.getByPlaceholderText('Search sets by name or code'), 'mrd')
    expect(screen.getByRole('button', { name: /Metal Raiders/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Starter Deck/ })).not.toBeInTheDocument()
  })

  it('list view persists and shows the full date', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(screen.queryByText('2002-06-26')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'List view' }))
    expect(localStorage.getItem('sets.view')).toBe('list')
    expect(screen.getByText('2002-06-26')).toBeInTheDocument()
  })

  it('empty started state offers Show all sets and Add card', async () => {
    const onAddCard = vi.fn()
    renderPage([LOB], onAddCard)
    expect(await screen.findByText("You haven't started any sets yet")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add card' }))
    expect(onAddCard).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Show all sets' }))
    expect(screen.getByRole('button', { name: /Legend of Blue Eyes/ })).toBeInTheDocument()
  })

  it('shows No sets match when search finds nothing', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await userEvent.type(screen.getByPlaceholderText('Search sets by name or code'), 'zzz')
    expect(screen.getByText('No sets match')).toBeInTheDocument()
  })

  it('opening a set shows the placeholder', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    expect(screen.getByTestId('open-set')).toHaveTextContent('Metal Raiders')
  })
})

describe('SetArt', () => {
  it('falls back to a placeholder with the set code when there is no image key', () => {
    renderWithProviders(<SetArt imageKey={null} setCode="LOB" />)
    expect(screen.getByTestId('set-art-placeholder')).toHaveTextContent('LOB')
  })

  it('uses the ygo-img set URL', () => {
    const { container } = renderWithProviders(<SetArt imageKey="LOB" setCode="LOB" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'ygo-img://set/LOB')
  })
})
