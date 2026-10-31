import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SetSummary } from '@shared/types'
import { SetsPage } from '@/features/sets/SetsPage'
import { searchPause } from './filterTestHelpers'
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

  it('a search matching only upcoming sets shows them open, without saving that', async () => {
    renderPage([OLD, LATER, FAR])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    const search = screen.getByRole('searchbox', { name: 'Search sets' })
    await userEvent.type(search, 'far')
    await searchPause()
    // Nothing in the main list matches, so the banner is the answer rather than "No sets match".
    expect(screen.queryByText('No sets match')).not.toBeInTheDocument()
    expect(banner()).toHaveTextContent('1 upcoming set')
    expect(banner()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Far Deck/ })).toBeInTheDocument()
    expect(localStorage.getItem('sets.upcomingOpen')).toBeNull()

    // It can still be collapsed for this search, and that isn't saved either.
    await userEvent.click(banner())
    expect(banner()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /Far Deck/ })).not.toBeInTheDocument()
    expect(localStorage.getItem('sets.upcomingOpen')).toBeNull()

    // Clearing the search goes back to the saved (collapsed) state.
    await userEvent.clear(search)
    await searchPause()
    expect(banner()).toHaveAttribute('aria-expanded', 'false')
    expect(banner()).toHaveTextContent('2 upcoming sets')

    // A search the main list answers leaves the banner as saved, and only counts matches.
    await userEvent.type(search, 'metal')
    await searchPause()
    expect(screen.queryByRole('button', { name: /upcoming set/ })).not.toBeInTheDocument()
    await userEvent.clear(search)
    await userEvent.type(search, 'r')
    await searchPause()
    expect(banner()).toHaveTextContent('2 upcoming sets')
    expect(banner()).toHaveAttribute('aria-expanded', 'false')
  })

  it('respects the language filter, and the banner reappears after switching to Japanese', async () => {
    const jaLater = set({ ...LATER, language: 'ja', setCode: 'LATJ' })
    const jaOld = set({ ...OLD, language: 'ja', setCode: 'MRDJ' })
    renderPage([OLD, jaOld, jaLater])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(screen.queryByRole('button', { name: /upcoming set/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Japanese' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: /upcoming set/ })).toHaveTextContent(
      '1 upcoming set'
    )
  })

  it('counts by rarities too: a set with only a rarity owned counts as started', async () => {
    localStorage.setItem('sets.countMode', 'rarities')
    const rarityOnly = set({ ...FAR, ownedCards: 0, ownedRarities: 1 })
    renderPage([OLD, rarityOnly, LATER])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(within(mainList()).getByRole('button', { name: /Far Deck/ })).toBeInTheDocument()
    expect(banner()).toHaveTextContent('1 upcoming set')
  })

  it('moves the cutoff on when the window regains focus or visibility after midnight', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 0))
    renderPage([OLD, LATER])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(banner()).toHaveTextContent('releasing after Nov 28')

    // Midnight passes with the window open: nothing changes until the user comes back.
    vi.setSystemTime(new Date(2026, 9, 30, 0, 1, 0))
    expect(banner()).toHaveTextContent('releasing after Nov 28')
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    // Later Booster (Nov 29) is now within 30 days, so the banner goes.
    expect(within(mainList()).getByRole('button', { name: /Later Booster/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upcoming set/ })).not.toBeInTheDocument()
  })

  it('rechecks the cutoff when the page becomes visible', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 0))
    renderPage([OLD, LATER])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    vi.setSystemTime(new Date(2026, 9, 30, 8, 0, 0))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.queryByRole('button', { name: /upcoming set/ })).not.toBeInTheDocument()
  })

  it('rechecks the cutoff when the sets query refetches', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 0))
    const { client } = renderPage([OLD, LATER])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    vi.setSystemTime(new Date(2026, 9, 30, 0, 1, 0))
    await act(async () => {
      await client.invalidateQueries()
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /upcoming set/ })).not.toBeInTheDocument()
    )
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

describe('upcoming cutoff near local midnight', () => {
  afterEach(() => vi.unstubAllEnvs())

  // Each moment's local date differs from its UTC date, so a UTC-based cutoff would be a day off.
  it.each([
    ['America/Los_Angeles', new Date('2026-10-30T06:30:00Z'), 'Nov 28'], // Oct 29, 23:30 local
    ['Pacific/Auckland', new Date('2026-10-28T11:30:00Z'), 'Nov 28'] // Oct 29, 00:30 local
  ])('uses the local date in %s', async (zone, at, label) => {
    vi.stubEnv('TZ', zone)
    vi.setSystemTime(at)
    expect(at.getDate()).toBe(29)
    expect(at.getUTCDate()).not.toBe(29)
    renderPage([OLD, LATER])
    await screen.findByRole('button', { name: /Metal Raiders/ })
    expect(banner()).toHaveTextContent(`releasing after ${label}`)
  })
})
