import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { DecksPage } from '@/features/decks/DecksPage'
import type { PackState } from '@shared/decks/pack'
import type { DeckCard, DeckEntry, DeckSummary } from '@shared/decks/types'
import type { Api } from '@shared/ipc'
import type { AccountStatus } from '@shared/types'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const POT = 55144522
const MAXX = 23434538
const card = (
  id: number,
  name: string,
  owned: number,
  price: number | null,
  frameType = 'effect'
): DeckCard => ({
  id,
  name,
  type: frameType === 'spell' ? 'Spell Card' : 'Effect Monster',
  frameType,
  imageId: null,
  owned,
  price,
  regionPrice: price
})
const facts: Record<number, DeckCard> = {
  [POT]: card(POT, 'Pot of Greed', 3, 1, 'spell'),
  [MAXX]: card(MAXX, 'Maxx "C"', 3, 1),
  1: card(1, 'Pricey', 0, 1.5),
  2: card(2, 'Mystery', 0, null)
}
for (let i = 100; i < 113; i++) facts[i] = card(i, `Filler ${i}`, 3, 1)
const fillers = (): DeckEntry[] =>
  Array.from({ length: 13 }, (_, i) => ({ section: 'main' as const, card: 100 + i, qty: 3 }))
const legalCards: DeckEntry[] = [
  ...fillers(),
  { section: 'main', card: 1, qty: 2 },
  { section: 'main', card: 2, qty: 1 }
]
const deck = (over: Partial<DeckSummary>): DeckSummary => ({
  uid: 'd1',
  game: 'ygo',
  format: 'advanced',
  name: 'Deck',
  private: false,
  coverImageId: null,
  cards: legalCards,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  lastSeen: null,
  ...over
})
const pack = (version: string, limits: Record<string, 0 | 1 | 2> = { [POT]: 0 }): PackState => ({
  state: 'ready',
  pack: {
    schema: 1,
    game: 'ygo',
    version,
    builtAt: new Date().toISOString(),
    sources: [],
    formats: { advanced: { limits, notReleased: {} }, ocg: { limits: {}, notReleased: {} } }
  }
})
const apiWith = (decks: DeckSummary[], rules: PackState, o: DeepPartial<Api> = {}): Api =>
  createMockApi({
    decks: {
      rules: vi.fn(async () => rules),
      list: vi.fn(async () => ({ decks, cardFacts: facts })),
      save: vi.fn(async () => 'new-uid'),
      get: vi.fn(async () => null)
    },
    ...o
  })

afterEach(() => {
  window.api = undefined as never
})

describe('the decks page', () => {
  it('lists decks with badge, count and cost', async () => {
    const api = apiWith(
      [
        deck({ uid: 'd1', name: 'Good' }),
        deck({
          uid: 'd2',
          name: 'Bad',
          cards: [{ section: 'main', card: POT, qty: 3 }]
        })
      ],
      pack('2026-11-22')
    )
    renderWithProviders(<DecksPage />, { api })
    const good = (await screen.findByText('Good')).closest('li') as HTMLElement
    const bad = screen.getByText('Bad').closest('li') as HTMLElement
    expect(await within(good).findByText('Legal')).toBeInTheDocument()
    expect(within(bad).getByText('Not legal')).toBeInTheDocument()
    expect(within(good).getByText('Advanced (TCG)')).toBeInTheDocument()
    expect(within(good).getByText(/Main 42/)).toBeInTheDocument()
    expect(within(good).getByText('$3.00 +1 unpriced')).toBeInTheDocument()
    expect(within(bad).getByText('Main 3 · Extra 0 · Side 0')).toBeInTheDocument()
  })

  it('shows Legality unknown without a pack', async () => {
    renderWithProviders(<DecksPage />, { api: apiWith([deck({})], { state: 'missing' }) })
    expect(await screen.findByText('Legality unknown')).toBeInTheDocument()
    expect(screen.queryByText('Legal')).not.toBeInTheDocument()
  })

  it('shows the overnight change', async () => {
    const maxx: DeckEntry[] = [...fillers(), { section: 'main', card: MAXX, qty: 3 }]
    const api = apiWith(
      [
        deck({
          cards: maxx,
          lastSeen: { status: 'legal', problems: [], packVersion: '2026-11-01' }
        })
      ],
      pack('2026-12-01', { [MAXX]: 0 })
    )
    renderWithProviders(<DecksPage />, { api })
    expect(await screen.findByText('Changed with the 2026-12-01 list')).toBeInTheDocument()
    expect(screen.getByText('Not legal')).toBeInTheDocument()
  })

  it('new deck saves with the chosen format and opens it', async () => {
    const api = apiWith([], pack('2026-11-22'))
    renderWithProviders(<DecksPage />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'New deck' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Format')).toHaveValue('advanced')
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Branded')
    await userEvent.selectOptions(within(dialog).getByLabelText('Format'), 'ocg')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create deck' }))
    await waitFor(() =>
      expect(api.decks.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Branded', format: 'ocg', cards: [] })
      )
    )
    expect(await screen.findByRole('button', { name: /Back/ })).toBeInTheDocument()
  })

  it('is read-only for a friend and uses their decks', async () => {
    const api = apiWith(
      [],
      { state: 'missing' },
      {
        friends: {
          decks: vi.fn(async () => ({ decks: [deck({ name: 'Theirs' })], cardFacts: facts }))
        }
      }
    )
    renderWithProviders(<DecksPage friendId={7} />, { api })
    expect(await screen.findByText('Theirs')).toBeInTheDocument()
    expect(api.friends.decks).toHaveBeenCalledWith(7)
    expect(screen.queryByRole('button', { name: 'New deck' })).not.toBeInTheDocument()
  })
})

const signedIn: AccountStatus = {
  state: 'idle',
  user: { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null },
  localOwner: 'Seto',
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0,
  signInRequired: true
}

describe('Decks in the nav', () => {
  const nav = async (active: 'ygo' | 'pkm'): Promise<string[]> => {
    const api = createMockApi({
      account: { status: async () => signedIn },
      games: {
        available: vi.fn(async () => ['ygo', 'pkm'] as never),
        active: vi.fn(async () => active)
      }
    })
    renderWithProviders(<App />, { api })
    const n = await screen.findByRole('navigation', { name: 'Main' })
    await waitFor(() => expect(within(n).getAllByRole('button').length).toBeGreaterThan(3))
    return within(n)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
  }
  it('is after Binders for Yu-Gi-Oh!', async () => {
    const names = await nav('ygo')
    expect(names[names.indexOf('Binders') + 1]).toBe('Decks')
  })
  it('is not in the nav for Pokémon', async () => {
    await waitFor(async () => expect(await nav('pkm')).toContain('Binders'))
    expect(await nav('pkm')).not.toContain('Decks')
  })
})
