import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { ScanSession, ScanSessionCard } from '@shared/scanSessions'
import { SessionFeed } from '@/features/sessions/SessionFeed'
import { replaySourceOfSession, sessionCardKey, sessionDate } from '@/features/sessions/sessionDate'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let n = 0
const card = (price: number | null, over: Partial<ScanSessionCard> = {}): ScanSessionCard => {
  n++
  return {
    cardId: n,
    pkey: `en|${n}|X|R`,
    printingId: n,
    imageId: n,
    photoId: null,
    name: `Card ${n}`,
    setCode: 'X',
    rarity: 'R',
    quantity: 1,
    price,
    guess: false,
    addedAt: n,
    ...over
  }
}
const session = (cards: ScanSessionCard[], over: Partial<ScanSession> = {}): ScanSession => ({
  uid: 's1',
  game: 'ygo',
  cards,
  friendsVisible: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over
})
const feed = (
  sessions: ScanSession[],
  owner = true,
  onOpenCard = vi.fn()
): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(
    <SessionFeed sessions={sessions} owner={owner} variant="desktop" onOpenCard={onOpenCard} />,
    { api: createMockApi() }
  )

describe('sessionDate', () => {
  const now = new Date(2026, 10, 5, 12, 0)
  it('says today, yesterday and older dates', () => {
    expect(sessionDate(new Date(2026, 10, 5, 21, 42).toISOString(), now)).toBe('Today · 9:42 PM')
    expect(sessionDate(new Date(2026, 10, 4, 20, 15).toISOString(), now)).toBe(
      'Yesterday · 8:15 PM'
    )
    expect(sessionDate(new Date(2026, 10, 2, 20, 15).toISOString(), now)).toBe('Nov 2 · 8:15 PM')
  })
})

describe('sessionDate years', () => {
  const now = new Date(2026, 10, 5, 12, 0)
  it('adds the year only for another year', () => {
    expect(sessionDate(new Date(2025, 10, 2, 20, 15).toISOString(), now)).toBe(
      'Nov 2, 2025 · 8:15 PM'
    )
    expect(sessionDate(new Date(2026, 0, 2, 20, 15).toISOString(), now)).toBe('Jan 2 · 8:15 PM')
  })
})

describe('replaySourceOfSession', () => {
  it('uses the session date in the header', () => {
    const s = session([card(5), card(2)], {
      createdAt: new Date(2026, 10, 2, 20, 15).toISOString()
    })
    const src = replaySourceOfSession(s)
    expect(src.header).toBe('Nov 2 · 2 cards · $7.00')
    expect(src.pulls).toHaveLength(2)
  })

  it("takes an unpriced chase rarity in the session's game", () => {
    const sir = card(null, { rarity: 'Special Illustration Rare' })
    const src = replaySourceOfSession(session([card(5), sir], { game: 'pkm' }))
    expect(src.pulls.map((p) => p.key)).toEqual([sessionCardKey(sir), expect.any(String)])
  })
})

describe('the session feed', () => {
  it('shows the header and tiles dearest first', () => {
    const cards = [card(1), card(null), card(9), card(3)]
    feed([session(cards)])
    expect(screen.getByText(/^Today/)).toBeInTheDocument()
    expect(screen.getByText('4 cards')).toBeInTheDocument()
    expect(screen.getByText('$13.00')).toBeInTheDocument()
    const tiles = screen.getAllByRole('button', { name: /^Card \d+/ })
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual([
      expect.stringContaining(cards[2].name),
      expect.stringContaining(cards[3].name),
      expect.stringContaining(cards[0].name),
      expect.stringContaining(cards[1].name)
    ])
    expect(within(tiles[3]).getByText('—')).toBeInTheDocument()
  })

  it('rings the replay cards and only them', () => {
    const cards = [card(5), card(0.5), card(2, { guess: true })]
    feed([session(cards)])
    const ringed = screen
      .getAllByRole('button', { name: /^Card \d+/ })
      .filter((t) => t.hasAttribute('data-replay'))
    expect(ringed).toHaveLength(1)
    expect(ringed[0]).toHaveAccessibleName(/Card \d+/)
    expect(ringed[0].getAttribute('aria-label')).toContain(cards[0].name)
  })

  it('collapses 40 cards to two rows, the +N more tile last on row two, and expands', async () => {
    const cards = Array.from({ length: 40 }, (_, i) => card(i + 1))
    feed([session(cards)])
    // 8 columns until measured: 15 tiles and the "+25 more" tile fill the two rows.
    expect(screen.getAllByRole('button', { name: /^Card \d+/ })).toHaveLength(15)
    await userEvent.click(screen.getByRole('button', { name: '+25 more' }))
    expect(screen.getAllByRole('button', { name: /^Card \d+/ })).toHaveLength(40)
  })

  it('shows every card with no +N more tile when two rows hold them all', () => {
    feed([session(Array.from({ length: 16 }, (_, i) => card(i + 1)))])
    expect(screen.getAllByRole('button', { name: /^Card \d+/ })).toHaveLength(16)
    expect(screen.queryByRole('button', { name: /more$/ })).toBeNull()
  })

  it('17 cards show 15 tiles and +2 more', () => {
    feed([session(Array.from({ length: 17 }, (_, i) => card(i + 1)))])
    expect(screen.getAllByRole('button', { name: /^Card \d+/ })).toHaveLength(15)
    expect(screen.getByRole('button', { name: '+2 more' })).toBeInTheDocument()
  })

  it('shows a x2 badge for more than one copy', () => {
    feed([session([card(3, { quantity: 2 })])])
    expect(screen.getByText('×2')).toBeInTheDocument()
  })

  it('gives the owner a menu and not a friend', async () => {
    feed([session([card(3)])], false)
    expect(screen.queryByRole('button', { name: 'Session options' })).not.toBeInTheDocument()
  })

  it('hides and shows from friends', async () => {
    const { api } = feed([session([card(3)])])
    await userEvent.click(screen.getByRole('button', { name: 'Session options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide from friends' }))
    await waitFor(() => expect(api.sessions.setHidden).toHaveBeenCalledWith('s1', true))
  })

  it('offers to show a hidden one, and tags it for the owner only', async () => {
    const hidden = session([card(3)], { friendsVisible: false })
    const { api, unmount } = feed([hidden])
    expect(screen.getByText('hidden')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Session options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Show to friends' }))
    await waitFor(() => expect(api.sessions.setHidden).toHaveBeenCalledWith('s1', false))
    unmount()
    feed([hidden], false)
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
  })

  it('asks before deleting', async () => {
    const { api } = feed([session([card(3)])])
    await userEvent.click(screen.getByRole('button', { name: 'Session options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(
      screen.getByText('Delete this session? The cards stay in your collection.')
    ).toBeInTheDocument()
    expect(api.sessions.delete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.sessions.delete).toHaveBeenCalledWith('s1'))
  })

  it('opens a card on click', async () => {
    const c = card(3)
    const onOpen = vi.fn()
    feed([session([c])], true, onOpen)
    await userEvent.click(screen.getByRole('button', { name: /^Card \d+/ }))
    expect(onOpen).toHaveBeenCalledWith(c)
  })

  it('lists the newest session first and never says night', () => {
    const old = session([card(3)], {
      uid: 'a',
      createdAt: new Date(2020, 0, 1, 9, 0).toISOString()
    })
    const fresh = session([card(4)], { uid: 'b' })
    const { container } = feed([old, fresh])
    const text = container.textContent ?? ''
    expect(text.indexOf('Today')).toBeLessThan(text.indexOf('Jan 1'))
    expect(text.toLowerCase()).not.toContain('night')
  })

  it('says so when empty', () => {
    feed([])
    expect(
      screen.getByText('No sessions yet. Add cards from the scanner and they show up here.')
    ).toBeInTheDocument()
  })
})
