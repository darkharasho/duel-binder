import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SetSummary } from '@shared/types'
import { SetsPage } from '@/features/sets/SetsPage'
import { createMockApi, renderWithProviders } from './mockApi'

const set = (o: Partial<SetSummary>): SetSummary => ({
  language: 'en',
  setName: 'Set',
  setCode: 'SET',
  tcgDate: '2002-06-26',
  imageKey: 'SET',
  packImageKey: null,
  logoImageKey: null,
  coverImageId: null,
  totalCards: 10,
  ownedCards: 0,
  totalRarities: 10,
  ownedRarities: 0,
  listRows: null,
  unmatchedRows: null,
  ...o
})

// Today is 2026-10-29 (local), so the last date in the main list is 2026-11-28.
const OLD = set({ setName: 'Metal Raiders', setCode: 'MRD', tcgDate: '2002-06-26' })
const SOON = set({ setName: 'Soon Booster', setCode: 'SOON', tcgDate: '2026-11-27' }) // 29 days
const EDGE = set({ setName: 'Edge Booster', setCode: 'EDGE', tcgDate: '2026-11-28' }) // 30 days
const LATER = set({ setName: 'Later Booster', setCode: 'LATR', tcgDate: '2026-11-29' }) // 31 days
const FAR = set({ setName: 'Far Deck', setCode: 'FARD', tcgDate: '2027-03-01' })
const UNDATED = set({ setName: 'Mystery Promo', setCode: 'MYST', tcgDate: null })

function renderPage(sets: SetSummary[], platform?: string): ReturnType<typeof renderWithProviders> {
  const api = createMockApi({
    sets: { list: async () => sets },
    ...(platform ? { window: { platform } } : {})
  })
  return renderWithProviders(<SetsPage onAddCard={() => {}} onAddMissing={() => {}} />, { api })
}

const mainList = (): HTMLElement => screen.getByRole('list', { name: 'Sets' })
const banner = (): HTMLElement => screen.getByRole('button', { name: /upcoming set/ })

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 29, 12, 0, 0))
})
afterEach(() => vi.useRealTimers())

describe('SetsPage upcoming sets', () => {
  it('hides sets more than 30 days out behind a collapsed banner with their count', async () => {
    renderPage([OLD, SOON, EDGE, LATER, FAR, UNDATED])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    const list = mainList()
    for (const name of [/Metal Raiders/, /Soon Booster/, /Edge Booster/, /Mystery Promo/]) {
      expect(within(list).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /Later Booster/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Far Deck/ })).not.toBeInTheDocument()
    expect(banner()).toHaveTextContent('2 upcoming sets · releasing after Nov 28')
    expect(banner()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Upcoming sets' })).not.toBeInTheDocument()
  })

  it('expanding shows the hidden sets, clickable and in the current sort; the choice persists', async () => {
    const first = renderPage([OLD, LATER, FAR])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    const toggle = banner()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const upcoming = screen.getByRole('list', { name: 'Upcoming sets' })
    expect(toggle.getAttribute('aria-controls')).toBe(upcoming.parentElement?.id)
    // Date sort is newest first.
    const names = within(upcoming)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names[0]).toMatch(/Far Deck/)
    expect(names[1]).toMatch(/Later Booster/)
    expect(localStorage.getItem('sets.upcomingOpen')).toBe('open')

    first.unmount()
    renderPage([OLD, LATER, FAR])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(banner()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list', { name: 'Upcoming sets' })).toBeInTheDocument()

    await userEvent.click(banner())
    expect(screen.queryByRole('button', { name: /Far Deck/ })).not.toBeInTheDocument()
    expect(localStorage.getItem('sets.upcomingOpen')).toBe('closed')
  })

  it('keeps a started future set in the main list', async () => {
    const started = set({ ...FAR, ownedCards: 1, ownedRarities: 1 })
    renderPage([OLD, started, LATER])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(within(mainList()).getByRole('button', { name: /Far Deck/ })).toBeInTheDocument()
    expect(banner()).toHaveTextContent('1 upcoming set · releasing after Nov 28')
  })

  it('shows no banner when there are no future sets', async () => {
    renderPage([OLD, SOON, UNDATED])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(screen.queryByRole('button', { name: /upcoming set/ })).not.toBeInTheDocument()
  })

  it('counts only upcoming sets that match the search, and finds one by search', async () => {
    renderPage([OLD, LATER, FAR])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    await userEvent.type(screen.getByRole('textbox', { name: 'Search sets' }), 'far')
    // Nothing in the main list matches, so the banner is the answer rather than "No sets match".
    expect(banner()).toHaveTextContent('1 upcoming set')
    expect(screen.queryByText('No sets match')).not.toBeInTheDocument()
    await userEvent.click(banner())
    expect(screen.getByRole('button', { name: /Far Deck/ })).toBeInTheDocument()

    await userEvent.clear(screen.getByRole('textbox', { name: 'Search sets' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search sets' }), 'metal')
    expect(screen.queryByRole('button', { name: /upcoming set/ })).not.toBeInTheDocument()
  })

  it('respects the language filter', async () => {
    const jaLater = set({ ...LATER, language: 'ja', setCode: 'LATJ' })
    renderPage([OLD, jaLater])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(screen.queryByRole('button', { name: /upcoming set/ })).not.toBeInTheDocument()
  })

  it('works in the phone layout', async () => {
    localStorage.setItem('sets.view', 'grid')
    renderPage([OLD, LATER], 'phone')
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(mainList()).toHaveAttribute('data-view', 'list')
    await userEvent.click(banner())
    expect(screen.getByRole('list', { name: 'Upcoming sets' })).toHaveAttribute('data-view', 'list')
    expect(screen.getByRole('button', { name: /Later Booster/ })).toBeInTheDocument()
  })
})
