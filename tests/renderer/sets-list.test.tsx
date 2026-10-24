import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SetSummary } from '@shared/types'
import { SetsPage } from '@/features/sets/SetsPage'
import { SetArt } from '@/features/sets/SetArt'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist } from './setFixtures'

const set = (o: Partial<SetSummary>): SetSummary => ({
  language: 'en',
  setName: 'Set',
  setCode: 'SET',
  tcgDate: '2002-06-26',
  imageKey: 'SET',
  coverImageId: null,
  totalCards: 1,
  ownedCards: 0,
  totalRarities: 1,
  ownedRarities: 0,
  listRows: null,
  unmatchedRows: null,
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

describe('SetsPage languages', () => {
  const LOB_JA = set({
    language: 'ja',
    setName: 'Legend of Blue Eyes White Dragon',
    setCode: 'LB',
    totalCards: 61,
    ownedCards: 1
  })
  const LOB_EN = set({
    setName: 'Legend of Blue Eyes White Dragon',
    setCode: 'LOB',
    totalCards: 126,
    ownedCards: 1
  })

  it('shows only English by default; choosing Japanese shows the JP tile and opens it in ja', async () => {
    const checklist = vi.fn(async () => metalRaidersChecklist)
    const api = createMockApi({ sets: { list: async () => [LOB_EN, LOB_JA], checklist } })
    renderWithProviders(<SetsPage onAddCard={() => {}} onAddMissing={() => {}} />, { api })
    const tile = await screen.findByRole('button', { name: /Legend of Blue Eyes/ })
    expect(within(tile).queryByText('JP')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Legend of Blue Eyes/ })).toHaveLength(1)

    await userEvent.click(screen.getByRole('combobox', { name: 'Language' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Japanese' }))
    const jp = await screen.findByRole('button', { name: /Legend of Blue Eyes/ })
    expect(within(jp).getByText('JP')).toBeInTheDocument()
    await userEvent.click(jp)
    await waitFor(() =>
      expect(checklist).toHaveBeenCalledWith('Legend of Blue Eyes White Dragon', 'ja')
    )
  })

  it('header counts only the selected language', async () => {
    localStorage.setItem('language.filter', 'ja')
    renderPage([LOB_EN, LOB_JA, MR])
    expect(await screen.findByText("You've started 1 of 1 sets · 0 complete")).toBeInTheDocument()
  })
})

describe('SetsPage', () => {
  it('shows the header summary and lists unstarted sets by default', async () => {
    renderPage()
    expect(await screen.findByText("You've started 2 of 3 sets · 1 complete")).toBeInTheDocument()
    const lob = screen.getByRole('button', { name: /Legend of Blue Eyes/ })
    expect(lob).toHaveAttribute('data-started', 'false')
    expect(within(lob).getByText('Not started')).toBeInTheDocument()
  })

  it('Started hides unstarted sets, and the filter is remembered', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Legend of Blue Eyes/ })
    await userEvent.click(screen.getByRole('radio', { name: 'Started' }))
    expect(screen.queryByRole('button', { name: /Legend of Blue Eyes/ })).not.toBeInTheDocument()
    expect(localStorage.getItem('sets.filter')).toBe('started')
  })

  it('marks complete sets', async () => {
    renderPage()
    const sd = await screen.findByRole('button', { name: /Starter Deck/ })
    expect(within(sd).getByLabelText('Complete')).toBeInTheDocument()
    expect(sd).toHaveTextContent('1 / 1')
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

  it('opens as a list with month and year; grid view persists and shows the year', async () => {
    renderPage()
    const mr = await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(mr).toHaveTextContent('MRD · Jun 2002')
    await userEvent.click(screen.getByRole('radio', { name: 'Grid view' }))
    expect(localStorage.getItem('sets.view')).toBe('grid')
    expect(screen.getByRole('button', { name: /Metal Raiders/ })).toHaveTextContent('MRD · 2002')
  })

  it('empty started state offers Show all sets and Add card', async () => {
    const onAddCard = vi.fn()
    localStorage.setItem('sets.filter', 'started')
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

  it('opening a set shows its checklist and All sets returns to the list', async () => {
    const api = createMockApi({
      sets: { list: async () => [MR], checklist: async () => metalRaidersChecklist }
    })
    renderWithProviders(<SetsPage onAddCard={() => {}} onAddMissing={() => {}} />, { api })
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    expect(await screen.findByRole('button', { name: 'Alpha Dragon' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /All sets/ }))
    expect(await screen.findByText(/You've started/)).toBeInTheDocument()
  })
})

describe('SetArt', () => {
  it('falls back to a placeholder with the set code when there is no image key', () => {
    renderWithProviders(<SetArt imageKey={null} setCode="LOB" />)
    expect(screen.getByTestId('set-art-placeholder')).toHaveTextContent('LOB')
  })

  it('prefers the headline card artwork and falls back to the pack photo', () => {
    const { container } = renderWithProviders(
      <SetArt imageKey="LOB" coverImageId={7} setCode="LOB" />
    )
    const img = container.querySelector('img')!
    expect(img).toHaveAttribute('src', 'ygo-img://cropped/7')
    fireEvent.error(img)
    expect(container.querySelector('img')).toHaveAttribute('src', 'ygo-img://set/LOB')
  })

  it('uses the ygo-img set URL', () => {
    const { container } = renderWithProviders(<SetArt imageKey="LOB" setCode="LOB" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'ygo-img://set/LOB')
  })

  it('Esc leaves a set', async () => {
    const api = createMockApi({
      sets: { list: async () => [MR], checklist: async () => metalRaidersChecklist }
    })
    renderWithProviders(<SetsPage onAddCard={() => {}} onAddMissing={() => {}} />, { api })
    await userEvent.click(await screen.findByRole('button', { name: /Metal Raiders/ }))
    await screen.findByRole('button', { name: 'Alpha Dragon' })
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/You've started/)).toBeInTheDocument()
  })
})
