import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SetSummary } from '@shared/types'
import { SetsPage } from '@/features/sets/SetsPage'
import { SetArt } from '@/features/sets/SetArt'
import { searchPause } from './filterTestHelpers'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist } from './setFixtures'

const set = (o: Partial<SetSummary>): SetSummary => ({
  language: 'en',
  setName: 'Set',
  setCode: 'SET',
  tcgDate: '2002-06-26',
  imageKey: 'SET',
  packImageKey: null,
  logoImageKey: null,
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
  setName: 'Structure Deck: Albaz Strike',
  setCode: 'SDAZ',
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

const openPanel = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
}
const closePanel = async (): Promise<void> => {
  await userEvent.keyboard('{Escape}')
}

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

    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Japanese' }))
    await closePanel()
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
  it('type filter narrows the list and shows a removable chip', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: /Decks/ }))
    await closePanel()
    expect(screen.getByRole('button', { name: /Albaz Strike/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Metal Raiders/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Decks filter' })).toBeInTheDocument()
    // English, the default language, and Decks.
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toHaveTextContent(
      /^Filters2$/
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove Decks filter' }))
    expect(screen.getByRole('button', { name: /Metal Raiders/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Albaz Strike/ })).toBeInTheDocument()
  })

  it('remembers ticked types', async () => {
    const first = renderPage()
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: /Decks/ }))
    await closePanel()
    first.unmount()
    renderPage()
    expect(await screen.findByRole('button', { name: /Albaz Strike/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Metal Raiders/ })).not.toBeInTheDocument()
  })

  it('ignores a broken stored type list', async () => {
    localStorage.setItem('sets.types', '{bad')
    const first = renderPage()
    expect(await screen.findByRole('button', { name: /Metal Raiders/ })).toBeInTheDocument()
    first.unmount()
    localStorage.setItem('sets.types', '["nope","deck"]')
    renderPage()
    expect(await screen.findByRole('button', { name: /Albaz Strike/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Metal Raiders/ })).not.toBeInTheDocument()
  })

  it('Clear all resets types, progress and language but not sort or count mode', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Every rarity' }))
    await userEvent.click(screen.getByRole('button', { name: 'Started' }))
    await userEvent.click(screen.getByRole('button', { name: /Decks/ }))
    await closePanel()
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.queryAllByRole('button', { name: /^Remove .* filter$/ })).toHaveLength(0)
    await openPanel()
    expect(screen.getByRole('button', { name: 'Started' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Decks/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Every rarity' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('no matching types shows No sets match', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: /Tins/ }))
    await closePanel()
    expect(screen.getByText('No sets match')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Filters/ })).toBeEnabled()
  })

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
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Started' }))
    await closePanel()
    expect(screen.queryByRole('button', { name: /Legend of Blue Eyes/ })).not.toBeInTheDocument()
    expect(localStorage.getItem('sets.filter')).toBe('started')
  })

  it('marks complete sets', async () => {
    renderPage()
    const sd = await screen.findByRole('button', { name: /Albaz Strike/ })
    expect(within(sd).getByLabelText('Complete')).toBeInTheDocument()
    expect(sd).toHaveTextContent('1 / 1')
  })

  it('count mode changes progress and persists', async () => {
    renderPage()
    const mr = await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(within(mr).getByText('1 / 3')).toBeInTheDocument()
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Every rarity' }))
    await closePanel()
    expect(
      within(screen.getByRole('button', { name: /Metal Raiders/ })).getByText('1 / 4')
    ).toBeInTheDocument()
    expect(localStorage.getItem('sets.countMode')).toBe('rarities')
  })

  it('search filters by code', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await userEvent.type(screen.getByPlaceholderText('Search sets by name or code'), 'mrd')
    await searchPause()
    expect(screen.getByRole('button', { name: /Metal Raiders/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Albaz Strike/ })).not.toBeInTheDocument()
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
    await searchPause()
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

  it('floats the logo over the blurred headline card, falling back to the pack', () => {
    const { container, getByTestId } = renderWithProviders(
      <SetArt
        imageKey="LOB"
        packImageKey="yc-abc"
        logoImageKey="yp-logo"
        coverImageId={7}
        setCode="LOB"
      />
    )
    expect(getByTestId('set-art-backdrop')).toHaveAttribute('src', 'ygo-img://cropped/7')
    fireEvent.error(getByTestId('set-art-logo'))
    expect(getByTestId('set-art-pack')).toHaveAttribute('src', 'ygo-img://set/yc-abc')
    fireEvent.error(getByTestId('set-art-pack'))
    expect(getByTestId('set-art-set')).toHaveAttribute('src', 'ygo-img://set/LOB')
    fireEvent.error(getByTestId('set-art-set'))
    expect(container).toHaveTextContent('LOB')
    expect(getByTestId('set-art-backdrop')).toBeInTheDocument()
  })

  it('blurs the pack behind itself when there is no headline card', () => {
    const { getByTestId } = renderWithProviders(
      <SetArt imageKey={null} packImageKey="yc-abc" setCode="LOB" />
    )
    expect(getByTestId('set-art-backdrop')).toHaveAttribute('src', 'ygo-img://set/yc-abc')
    expect(getByTestId('set-art-pack')).toHaveAttribute('src', 'ygo-img://set/yc-abc')
  })

  it('shimmers until its backdrop loads, keeping the art hidden until each image arrives', () => {
    const { container, getByTestId } = renderWithProviders(
      <SetArt imageKey="LOB" logoImageKey="yp-logo" coverImageId={7} setCode="LOB" />
    )
    const tile = container.firstElementChild!
    expect(tile).toHaveClass('art-loading')
    expect(getByTestId('set-art-backdrop')).toHaveClass('opacity-0')
    expect(getByTestId('set-art-logo')).toHaveClass('opacity-0')
    fireEvent.load(getByTestId('set-art-backdrop'))
    expect(tile).not.toHaveClass('art-loading')
    expect(getByTestId('set-art-backdrop')).toHaveClass('art-reveal')
    fireEvent.load(getByTestId('set-art-logo'))
    expect(getByTestId('set-art-logo')).not.toHaveClass('opacity-0')
  })

  it('uses the ygo-img set URL', () => {
    renderWithProviders(<SetArt imageKey="LOB" setCode="LOB" />)
    expect(screen.getByTestId('set-art-set')).toHaveAttribute('src', 'ygo-img://set/LOB')
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
