import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { DeckPage } from '@/features/decks/DeckPage'
import { DecksPage } from '@/features/decks/DecksPage'
import { OFFLINE_MESSAGE } from '@shared/friends'
import type { PackState } from '@shared/decks/pack'
import type { DeckCard, DeckDetail, DeckEntry, DeckSummary } from '@shared/decks/types'
import type { Api } from '@shared/ipc'
import type { AccountStatus } from '@shared/types'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

type DeckResolution = Awaited<ReturnType<Api['decks']['resolve']>>[number]
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
    ...o,
    decks: {
      rules: vi.fn(async () => rules),
      list: vi.fn(async () => ({ decks, cardFacts: facts })),
      save: vi.fn(async () => 'new-uid'),
      get: vi.fn(async () => null),
      ...o.decks
    }
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

  it('shows no badge while the rules are pending, and Legality unknown if they fail', async () => {
    const pending = apiWith(
      [deck({})],
      { state: 'missing' },
      {
        decks: { rules: vi.fn(() => new Promise<never>(() => {})) }
      }
    )
    const first = renderWithProviders(<DecksPage />, { api: pending })
    expect(await screen.findByText('Deck')).toBeInTheDocument()
    expect(screen.queryByText(/Legal|Not legal/)).not.toBeInTheDocument()
    first.unmount()
    const failing = apiWith(
      [deck({})],
      { state: 'missing' },
      {
        decks: { rules: vi.fn(async () => Promise.reject(new Error('offline'))) }
      }
    )
    renderWithProviders(<DecksPage />, { api: failing })
    expect(await screen.findByText('Legality unknown')).toBeInTheDocument()
  })

  it('shows an error line when the list fails', async () => {
    const api = apiWith(
      [],
      { state: 'missing' },
      {
        decks: { list: vi.fn(async () => Promise.reject(new Error('boom'))) }
      }
    )
    renderWithProviders(<DecksPage />, { api })
    expect(await screen.findByText('Could not load the decks.')).toBeInTheDocument()
    expect(screen.queryByText('Build your first deck')).not.toBeInTheDocument()
  })

  it('is read-only for a friend, shows their cost and opens their deck', async () => {
    const api = apiWith(
      [],
      { state: 'missing' },
      {
        friends: {
          decks: vi.fn(async () => ({ decks: [deck({ name: 'Theirs' })], cardFacts: facts })),
          deck: vi.fn(async () => null)
        }
      }
    )
    renderWithProviders(<DecksPage friendId={7} />, { api })
    const tile = (await screen.findByText('Theirs')).closest('li') as HTMLElement
    expect(api.friends.decks).toHaveBeenCalledWith(7)
    expect(screen.queryByRole('button', { name: 'New deck' })).not.toBeInTheDocument()
    expect(within(tile).getByText('$3.00 +1 unpriced')).toBeInTheDocument()
    await userEvent.click(within(tile).getByRole('button'))
    expect(await screen.findByRole('button', { name: /Back/ })).toBeInTheDocument()
    expect(api.friends.deck).toHaveBeenCalledWith(7, 'd1')
  })
})

const detail = (over: Partial<DeckDetail> = {}): DeckDetail => ({
  ...deck({}),
  notes: 'Side for the mirror',
  cover: null,
  cardFacts: facts,
  printingArt: {},
  ...over
})
const pageApi = (d: DeckDetail, rules: PackState, o: DeepPartial<Api> = {}): Api =>
  createMockApi({
    ...o,
    decks: {
      rules: vi.fn(async () => rules),
      list: vi.fn(async () => ({ decks: [], cardFacts: {} })),
      get: vi.fn(async () => d),
      save: vi.fn(async () => d.uid),
      remove: vi.fn(async () => undefined),
      markSeen: vi.fn(async () => undefined),
      ...o.decks
    }
  })
const entry = (name: string): HTMLElement => screen.getByRole('listitem', { name })
const SAVE_WAIT = { timeout: 2500 }

describe('the deck page', () => {
  it('adding a Link monster from search lands in Extra', async () => {
    const link = {
      id: 50,
      name: 'Linkuriboh',
      type: 'Link Monster',
      frameType: 'link',
      attribute: 'DARK',
      race: 'Cyberse',
      level: null,
      linkval: 1,
      atk: 300,
      def: null,
      imageId: 50,
      price: 0.2,
      releasedAt: null,
      owned: 1,
      defaultPrintingId: null
    }
    const api = pageApi(detail(), pack('2026-11-22'), {
      cards: { browse: vi.fn(async () => ({ cards: [link], total: 1 })) }
    })
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await userEvent.type(await screen.findByLabelText('Search cards'), 'Linku')
    await userEvent.click(await screen.findByRole('button', { name: 'Add Linkuriboh' }))
    const extra = screen.getByRole('region', { name: 'Extra Deck' })
    expect(within(extra).getByText('Linkuriboh')).toBeInTheDocument()
    expect(within(extra).getByText('Extra Deck 1 / 0–15')).toBeInTheDocument()
    await waitFor(
      () =>
        expect(api.decks.save).toHaveBeenCalledWith(
          expect.objectContaining({
            uid: 'd1',
            cards: expect.arrayContaining([{ section: 'extra', card: 50, qty: 1 }])
          })
        ),
      SAVE_WAIT
    )
  })

  it('+ past 3 copies shows the copy problem at once and still saves', async () => {
    const api = pageApi(detail(), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    expect(await screen.findByText('Main Deck 42 / 40–60')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add a copy of Filler 100' }))
    expect(
      screen.getByRole('button', { name: /4 × Filler 100: at most 3 copies/ })
    ).toBeInTheDocument()
    expect(screen.getByText('Not legal')).toBeInTheDocument()
    expect(api.decks.save).not.toHaveBeenCalled()
    await waitFor(
      () =>
        expect(api.decks.save).toHaveBeenCalledWith(
          expect.objectContaining({
            cards: expect.arrayContaining([{ section: 'main', card: 100, qty: 4 }])
          })
        ),
      SAVE_WAIT
    )
  })

  it('a failed save keeps the edit and offers retry', async () => {
    const save = vi.fn(async () => Promise.reject(new Error(OFFLINE_MESSAGE)))
    const api = pageApi(detail(), pack('2026-11-22'), { decks: { save } })
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await screen.findByText('Main Deck 42 / 40–60')
    await userEvent.click(screen.getByRole('button', { name: 'Add a copy of Pricey' }))
    expect(
      await screen.findByText(`Not saved: ${OFFLINE_MESSAGE}`, {}, SAVE_WAIT)
    ).toBeInTheDocument()
    expect(within(entry('Pricey')).getByText('0/3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(within(entry('Pricey')).getByText('0/3')).toBeInTheDocument()
  })

  it('a desktop save failure shows the reason without the IPC prefix', async () => {
    const save = vi.fn(async () =>
      Promise.reject(
        new Error("Error invoking remote method 'decks:save': Error: That deck is gone")
      )
    )
    const api = pageApi(detail(), pack('2026-11-22'), { decks: { save } })
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await screen.findByText('Main Deck 42 / 40–60')
    await userEvent.click(screen.getByRole('button', { name: 'Add a copy of Pricey' }))
    expect(
      await screen.findByText('Not saved: That deck is gone', {}, SAVE_WAIT)
    ).toBeInTheDocument()
  })

  it('tapping a problem highlights its entry', async () => {
    const cards: DeckEntry[] = [...fillers(), { section: 'main', card: POT, qty: 3 }]
    const api = pageApi(detail({ cards }), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    const problem = await screen.findByRole('button', { name: /Pot of Greed: Forbidden/ })
    expect(entry('Pot of Greed')).not.toHaveAttribute('data-highlight')
    await userEvent.click(problem)
    expect(entry('Pot of Greed')).toHaveAttribute('data-highlight', 'true')
  })

  it('opening a changed deck marks it seen', async () => {
    const maxx: DeckEntry[] = [...fillers(), { section: 'main', card: MAXX, qty: 3 }]
    const api = pageApi(
      detail({
        cards: maxx,
        lastSeen: { status: 'legal', problems: [], packVersion: '2026-11-01' }
      }),
      pack('2026-12-01', { [MAXX]: 0 })
    )
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await waitFor(() =>
      expect(api.decks.markSeen).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ status: 'illegal', packVersion: '2026-12-01' })
      )
    )
    expect(api.decks.markSeen).toHaveBeenCalledTimes(1)
  })

  it('friend view hides edit controls and notes', async () => {
    const api = pageApi(detail(), pack('2026-11-22'), {
      friends: { deck: vi.fn(async () => detail({ name: 'Theirs' })) }
    })
    renderWithProviders(<DeckPage uid="d1" friendId={7} onBack={vi.fn()} />, { api })
    expect(await screen.findByText('Main Deck 42 / 40–60')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Theirs' })).toBeInTheDocument()
    expect(screen.getByText('Legal')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search cards')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add a copy of/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove a copy of/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Deck name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument()
    expect(screen.queryByText('Side for the mirror')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(api.decks.markSeen).not.toHaveBeenCalled()
  })
})

describe('importing and exporting', () => {
  const LIST = '3 Pot of Greed\n2 Maxx C\n1 Mystery card\n!!!'
  const resolutions: DeckResolution[] = [
    { status: 'matched', card: POT },
    {
      status: 'ambiguous',
      options: [
        { card: MAXX, name: 'Maxx "C"', imageId: null },
        { card: 1, name: 'Pricey', imageId: null }
      ]
    },
    { status: 'unmatched' }
  ]
  const importApi = (): Api =>
    apiWith([], pack('2026-11-22'), {
      decks: { resolve: vi.fn(async () => resolutions) }
    })
  const paste = async (dialog: HTMLElement, text: string): Promise<void> => {
    await userEvent.click(within(dialog).getByLabelText('Deck list'))
    await userEvent.paste(text)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }))
  }

  it('import preview lists matched, ambiguous and unmatched lines, and save waits for them', async () => {
    const api = importApi()
    renderWithProviders(<DecksPage />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    await paste(dialog, LIST)
    expect(await within(dialog).findByText('Matched (1)')).toBeInTheDocument()
    expect(within(dialog).getByText('3 Pot of Greed')).toBeInTheDocument()
    expect(within(dialog).getByText('Pick one (1)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Pick a card for 2 Maxx C')).toBeInTheDocument()
    expect(within(dialog).getByText('Not found (2)')).toBeInTheDocument()
    expect(within(dialog).getByText('1 Mystery card')).toBeInTheDocument()
    expect(within(dialog).getByText('!!!')).toBeInTheDocument()
    expect(api.decks.resolve).toHaveBeenCalledTimes(1)
    expect(api.decks.resolve).toHaveBeenCalledWith([
      { name: 'Pot of Greed' },
      { name: 'Maxx C' },
      { name: 'Mystery card' }
    ])
    expect(within(dialog).getByRole('button', { name: 'Import deck' })).toBeDisabled()
  })

  it('dropping and picking enables save, and the saved deck has exactly the kept cards', async () => {
    const api = importApi()
    renderWithProviders(<DecksPage />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    await paste(dialog, LIST)
    await within(dialog).findByText('Matched (1)')
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Pick a card for 2 Maxx C'),
      'Maxx "C"'
    )
    const save = within(dialog).getByRole('button', { name: 'Import deck' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Drop 1 Mystery card' }))
    expect(save).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Drop !!!' }))
    expect(save).toBeEnabled()
    await userEvent.clear(within(dialog).getByLabelText('Name'))
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Imported')
    await userEvent.click(save)
    await waitFor(() =>
      expect(api.decks.save).toHaveBeenCalledWith({
        format: 'advanced',
        name: 'Imported',
        notes: '',
        cover: null,
        private: false,
        cards: [
          { section: 'main', card: POT, qty: 3 },
          { section: 'main', card: MAXX, qty: 2 }
        ]
      })
    )
  })

  it('replace asks first', async () => {
    const api = pageApi(detail(), pack('2026-11-22'), {
      decks: { resolve: vi.fn(async () => [resolutions[0]]) }
    })
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'Replace from list' }))
    const dialog = await screen.findByRole('dialog')
    await paste(dialog, '3 Pot of Greed')
    await within(dialog).findByText('Matched (1)')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace cards' }))
    expect(within(dialog).getByText('Replace the 42 cards in Deck?')).toBeInTheDocument()
    expect(api.decks.save).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, replace' }))
    await waitFor(() =>
      expect(api.decks.save).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 'd1', cards: [{ section: 'main', card: POT, qty: 3 }] })
      )
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('export copies the text list', async () => {
    const copy = vi.fn(async () => undefined)
    const cards: DeckEntry[] = [
      { section: 'main', card: POT, qty: 3 },
      { section: 'main', card: MAXX, qty: 2 },
      { section: 'side', card: 1, qty: 1 }
    ]
    const api = pageApi(detail({ cards }), pack('2026-11-22'), { dex: { copy } })
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy as text' }))
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(
        'Main Deck (5)\n2 Maxx "C"\n3 Pot of Greed\n\nSide Deck (1)\n1 Pricey'
      )
    )
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
    await waitFor(() =>
      expect(within(n).getByRole('button', { name: 'Binders' })).toBeInTheDocument()
    )
    return within(n)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
  }
  it('is after Binders for Yu-Gi-Oh!', async () => {
    const names = await nav('ygo')
    expect(names[names.indexOf('Binders') + 1]).toBe('Decks')
  })
  it('is not in the nav for Pokémon', async () => {
    expect(await nav('pkm')).not.toContain('Decks')
  })
})
