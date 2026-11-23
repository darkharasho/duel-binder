import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { DeckPage } from '@/features/decks/DeckPage'
import { DeckAdder } from '@/features/decks/DeckAdder'
import { ImportDialog } from '@/features/decks/ImportDialog'
import { ExportMenu } from '@/features/decks/ExportMenu'
import { DECK_FORMATS } from '@shared/decks/formats'
import { AddToDeck } from '@/features/decks/AddToDeck'
import { FriendBinder } from '@/features/friends/FriendBinder'
import { DecksPage } from '@/features/decks/DecksPage'
import { buildPreview, keptEntries } from '@/features/decks/deckImport'
import { changeSummary, moveEntry } from '@/features/decks/deckEntries'
import { parseYgoList } from '@shared/decks/ygo/lists'
import { parseMtgText } from '@shared/decks/magic/text'
import { parseOpText, toOpText } from '@shared/decks/onepiece/text'
import { encodeOplayV2, oplayLink } from '@shared/decks/onepiece/oplay'
import { OFFLINE_MESSAGE } from '@shared/friends'
import type { PackState } from '@shared/decks/pack'
import type { DeckCard, DeckDetail, DeckEntry, DeckSummary } from '@shared/decks/types'
import type { Api } from '@shared/ipc'
import type { AccountStatus, CardDetail, Friend } from '@shared/types'
import { toast } from 'sonner'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'

/** Opens one of the app's dropdowns and picks an option by its text. */
async function pick(trigger: HTMLElement, option: string): Promise<void> {
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

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
  regionPrice: price,
  sourceId: null,
  code: null,
  opNumber: null,
  opCardType: null,
  opColors: [],
  opCost: null,
  opBlock: null,
  mtgName: null,
  mtgTypeLine: null,
  mtgColorIdentity: [],
  mtgManaValue: null,
  mtgLayout: null
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
    expect(screen.getByText('3 × Maxx "C": Forbidden in Advanced')).toBeInTheDocument()
    expect(screen.getByText('Not legal')).toBeInTheDocument()
  })

  it('new deck saves with the chosen format and opens it', async () => {
    const api = apiWith([], pack('2026-11-22'))
    renderWithProviders(<DecksPage />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'New deck' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Format')).toHaveTextContent('Advanced (TCG)')
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Branded')
    await pick(within(dialog).getByLabelText('Format'), 'OCG')
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
/** Opens a deck tile's controls (the grid's popover). */
const openTile = async (name: string): Promise<void> => {
  await userEvent.click(within(entry(name)).getByRole('button'))
}
/** Opens the deck's ⋯ menu and picks an action. */
const deckMenu = async (item: string): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'More deck actions' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
}
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
    await openTile('Filler 100')
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
    await openTile('Pricey')
    await userEvent.click(screen.getByRole('button', { name: 'Add a copy of Pricey' }))
    expect(
      await screen.findByText(`Not saved: ${OFFLINE_MESSAGE}`, {}, SAVE_WAIT)
    ).toBeInTheDocument()
    expect(within(entry('Pricey')).getByText('×3')).toBeInTheDocument()
    expect(within(entry('Pricey')).getByText('need 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(within(entry('Pricey')).getByText('×3')).toBeInTheDocument()
    expect(within(entry('Pricey')).getByText('need 3')).toBeInTheDocument()
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
    await openTile('Pricey')
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

  it('an edit that changes the verdict marks the new one seen', async () => {
    const cards: DeckEntry[] = [...legalCards, { section: 'main', card: POT, qty: 1 }]
    const api = pageApi(detail({ cards }), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await waitFor(() =>
      expect(api.decks.markSeen).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ status: 'illegal', problems: [`limit:${POT}`] })
      )
    )
    await openTile('Pot of Greed')
    await userEvent.click(screen.getByRole('button', { name: 'Remove a copy of Pot of Greed' }))
    await waitFor(() =>
      expect(api.decks.markSeen).toHaveBeenLastCalledWith('d1', {
        status: 'legal',
        problems: [],
        packVersion: '2026-11-22'
      })
    )
    // A name edit leaves the verdict as it is: no new mark.
    await userEvent.type(screen.getByLabelText('Deck name'), '!')
    expect(api.decks.markSeen).toHaveBeenCalledTimes(2)
  })

  it('changing the format re-runs the checks and saves it', async () => {
    const ocg: PackState = {
      state: 'ready',
      pack: {
        schema: 1,
        game: 'ygo',
        version: '2026-11-22',
        builtAt: new Date().toISOString(),
        sources: [],
        formats: {
          advanced: { limits: {}, notReleased: {} },
          ocg: { limits: { [MAXX]: 1 }, notReleased: {} }
        }
      }
    }
    const cards: DeckEntry[] = [...fillers(), { section: 'main', card: MAXX, qty: 3 }]
    const api = pageApi(detail({ cards }), ocg)
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    expect(await screen.findByText('Legal')).toBeInTheDocument()
    await pick(screen.getByLabelText('Format'), 'OCG')
    expect(screen.getByText('Not legal')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /3 × Maxx "C": Limited to 1 in OCG/ })
    ).toBeInTheDocument()
    await waitFor(
      () =>
        expect(api.decks.save).toHaveBeenCalledWith(
          expect.objectContaining({ uid: 'd1', format: 'ocg' })
        ),
      SAVE_WAIT
    )
  })

  it('a deck in a format this app does not know shows its cards and asks for an update', async () => {
    const api = pageApi(detail({ format: 'genesys' }), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    expect(await screen.findByText(/needs a newer version of the app/)).toBeInTheDocument()
    expect(screen.queryByText("This deck isn't here any more.")).not.toBeInTheDocument()
    expect(screen.getByText('Update to check legality')).toBeInTheDocument()
    expect(screen.queryByText('Legal')).not.toBeInTheDocument()
    expect(screen.getByText('Main Deck 42 / 40–60')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add a copy of/ })).not.toBeInTheDocument()
    expect(within(entry('Pricey')).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Search cards')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More deck actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument()
  })

  it('moves an entry to another section from its menu', async () => {
    const api = pageApi(detail(), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await screen.findByText('Main Deck 42 / 40–60')
    await openTile('Pricey')
    expect(screen.queryByRole('button', { name: 'Move to Main Deck' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Move to Side Deck' }))
    const side = screen.getByRole('region', { name: 'Side Deck' })
    expect(within(side).getByText('Pricey')).toBeInTheDocument()
    expect(screen.getByText('Main Deck 40 / 40–60')).toBeInTheDocument()
    await waitFor(
      () =>
        expect(api.decks.save).toHaveBeenCalledWith(
          expect.objectContaining({
            cards: expect.arrayContaining([{ section: 'side', card: 1, qty: 2 }])
          })
        ),
      SAVE_WAIT
    )
  })

  it("names a card this catalog doesn't have yet", async () => {
    const cards: DeckEntry[] = [...legalCards, { section: 'side', card: 777, qty: 1 }]
    const api = pageApi(detail({ cards }), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    const side = await screen.findByRole('region', { name: 'Side Deck' })
    expect(within(side).getByText("Card #777 isn't in the catalog here yet")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /^Missing/ }))
    const missing = screen.getByRole('list', { name: 'Missing cards' })
    expect(
      within(missing).getByText("1 × Card #777 isn't in the catalog here yet")
    ).toBeInTheDocument()
  })

  const searchApi = (): Api => {
    const browse = (id: number, name: string, type: string, frameType: string) => ({
      id,
      name,
      type,
      frameType,
      attribute: null,
      race: '',
      level: null,
      linkval: null,
      atk: null,
      def: null,
      imageId: id,
      price: 0.2,
      releasedAt: null,
      owned: 0,
      defaultPrintingId: null
    })
    return pageApi(detail(), pack('2026-11-22'), {
      cards: {
        browse: vi.fn(async () => ({
          cards: [
            browse(50, 'Linkuriboh', 'Link Monster', 'link'),
            browse(60, 'Raigeki', 'Spell Card', 'spell')
          ],
          total: 2
        }))
      }
    })
  }

  it('a plain click on a result adds it where it goes: spells to Main, Link monsters to Extra', async () => {
    const api = searchApi()
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'Add Raigeki' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add Linkuriboh' }))
    expect(
      within(screen.getByRole('region', { name: 'Main Deck' })).getByText('Raigeki')
    ).toBeInTheDocument()
    expect(screen.getByText('Main Deck 43 / 40–60')).toBeInTheDocument()
    expect(screen.getByText('Extra Deck 1 / 0–15')).toBeInTheDocument()
    expect(screen.getByText('Side Deck 0 / 0–15')).toBeInTheDocument()
    await waitFor(
      () =>
        expect(api.decks.save).toHaveBeenCalledWith(
          expect.objectContaining({
            cards: expect.arrayContaining([
              { section: 'main', card: 60, qty: 1 },
              { section: 'extra', card: 50, qty: 1 }
            ])
          })
        ),
      SAVE_WAIT
    )
  })

  it('shift-click on a result adds it to Side', async () => {
    const api = searchApi()
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    const result = await screen.findByRole('button', { name: 'Add Linkuriboh' })
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(result)
    await user.keyboard('{/Shift}')
    const side = screen.getByRole('region', { name: 'Side Deck' })
    expect(within(side).getByText('Linkuriboh')).toBeInTheDocument()
    expect(screen.getByText('Side Deck 1 / 0–15')).toBeInTheDocument()
    expect(screen.getByText('Extra Deck 0 / 0–15')).toBeInTheDocument()
    // The result now counts the copy in the deck.
    expect(
      within(screen.getByRole('list', { name: 'Search results' })).getByText('1 in deck')
    ).toBeInTheDocument()
    await waitFor(
      () =>
        expect(api.decks.save).toHaveBeenCalledWith(
          expect.objectContaining({
            cards: expect.arrayContaining([{ section: 'side', card: 50, qty: 1 }])
          })
        ),
      SAVE_WAIT
    )
  })

  it("a tile's popover changes its copies", async () => {
    const api = pageApi(detail(), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await screen.findByText('Main Deck 42 / 40–60')
    expect(within(entry('Pricey')).getByText('×2')).toBeInTheDocument()
    await openTile('Pricey')
    const copies = screen.getByLabelText('Copies in this section')
    expect(copies).toHaveTextContent('2')
    expect(screen.getByText('own 0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add a copy of Pricey' }))
    expect(copies).toHaveTextContent('3')
    expect(within(entry('Pricey')).getByText('×3')).toBeInTheDocument()
    expect(screen.getByText('Main Deck 43 / 40–60')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove a copy of Pricey' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove a copy of Pricey' }))
    expect(copies).toHaveTextContent('1')
    expect(within(entry('Pricey')).getByText('×1')).toBeInTheDocument()
    await waitFor(
      () =>
        expect(api.decks.save).toHaveBeenLastCalledWith(
          expect.objectContaining({
            cards: expect.arrayContaining([{ section: 'main', card: 1, qty: 1 }])
          })
        ),
      SAVE_WAIT
    )
  })

  it('Delete in the deck menu asks first', async () => {
    const onBack = vi.fn()
    const api = pageApi(detail(), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={onBack} />, { api })
    await screen.findByText('Main Deck 42 / 40–60')
    await deckMenu('Delete')
    expect(screen.getByText('Delete this deck?')).toBeInTheDocument()
    expect(api.decks.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByText('Delete this deck?')).not.toBeInTheDocument()
    await deckMenu('Delete')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(api.decks.remove).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
  })

  it('the Missing tab lists the copies still to buy', async () => {
    const api = pageApi(detail(), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await screen.findByText('Main Deck 42 / 40–60')
    expect(screen.getByText('Own 39 of 42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Missing $3.00' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Missing cards' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Missing · 3' }))
    const missing = screen.getByRole('list', { name: 'Missing cards' })
    expect(within(missing).getByText('2 × Pricey')).toBeInTheDocument()
    expect(within(missing).getByText('1 × Mystery')).toBeInTheDocument()
    expect(screen.getByText('Total $3.00 +1 unpriced')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy as list/ })).toBeInTheDocument()
  })

  it('the problems bar shows the first problem, expands to all and highlights one', async () => {
    const cards: DeckEntry[] = [
      ...fillers().map((e) => (e.card === 100 ? { ...e, qty: 4 } : e)),
      { section: 'main', card: POT, qty: 3 }
    ]
    const api = pageApi(detail({ cards }), pack('2026-11-22'))
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    const bar = await screen.findByRole('region', { name: 'Deck check' })
    expect(within(bar).getByText('2 problems')).toBeInTheDocument()
    expect(within(bar).getAllByRole('button', { name: /×/ })).toHaveLength(1)
    expect(within(bar).queryByRole('list', { name: 'Problems' })).not.toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: /Show all/ }))
    const list = within(bar).getByRole('list', { name: 'Problems' })
    expect(within(list).getAllByRole('button')).toHaveLength(2)
    expect(entry('Filler 100')).not.toHaveAttribute('data-highlight')
    await userEvent.click(within(list).getByRole('button', { name: /4 × Filler 100/ }))
    expect(entry('Filler 100')).toHaveAttribute('data-highlight', 'true')
    expect(entry('Pot of Greed')).not.toHaveAttribute('data-highlight')
    // The legality chip opens it too.
    await userEvent.click(within(bar).getByRole('button', { name: /Show less/ }))
    expect(within(bar).queryByRole('list', { name: 'Problems' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Not legal'))
    expect(within(bar).getByRole('list', { name: 'Problems' })).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'More deck actions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
    expect(within(entry('Pricey')).queryByRole('button')).not.toBeInTheDocument()
    expect(api.decks.markSeen).not.toHaveBeenCalled()
  })
})

describe('importing and exporting', () => {
  const LIST = '3 Pot of Greed\n2 Maxx C\n1 Mystery card\n!!!'
  const resolutions: DeckResolution[] = [
    { status: 'matched', card: POT, name: 'Pot of Greed', frameType: 'spell' },
    {
      status: 'ambiguous',
      options: [
        { card: MAXX, name: 'Maxx "C"', frameType: 'effect', imageId: null },
        { card: 1, name: 'Pricey', frameType: 'effect', imageId: null }
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
    await pick(within(dialog).getByLabelText('Pick a card for 2 Maxx C'), 'Maxx "C"')
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

  it('a .ydk import lists the matched cards by name', async () => {
    const api = apiWith([], pack('2026-11-22'), {
      decks: {
        resolve: vi.fn(async () => [
          { status: 'matched' as const, card: POT, name: 'Pot of Greed', frameType: 'spell' },
          { status: 'unmatched' as const }
        ])
      }
    })
    renderWithProviders(<DecksPage />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    await paste(dialog, `#main\n${POT}\n${POT}\n12345678\n#extra\n!side\n`)
    expect(await within(dialog).findByText('2 Pot of Greed')).toBeInTheDocument()
    expect(within(dialog).getByText('#12345678 (not in the catalog)')).toBeInTheDocument()
    expect(within(dialog).queryByText(/#55144522/)).not.toBeInTheDocument()
  })

  it('editing the text after a preview clears it', async () => {
    const api = importApi()
    renderWithProviders(<DecksPage />, { api })
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    await paste(dialog, LIST)
    await within(dialog).findByText('Matched (1)')
    await pick(within(dialog).getByLabelText('Pick a card for 2 Maxx C'), 'Maxx "C"')
    await userEvent.type(within(dialog).getByLabelText('Deck list'), 'x')
    expect(within(dialog).queryByText('Matched (1)')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Import deck' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }))
    expect(await within(dialog).findByLabelText('Pick a card for 2 Maxx C')).toBeInTheDocument()
  })

  it('a list without headers puts Extra Deck monsters in Extra; a headed list is untouched', () => {
    const LINK = 50
    const res: DeckResolution[] = [
      { status: 'matched', card: POT, name: 'Pot of Greed', frameType: 'spell' },
      { status: 'matched', card: LINK, name: 'Linkuriboh', frameType: 'link' }
    ]
    const bare = buildPreview(parseYgoList('3 Pot of Greed\n1 Linkuriboh'), res, 'text')
    expect(keptEntries(bare, {})).toEqual([
      { section: 'main', card: POT, qty: 3 },
      { section: 'extra', card: LINK, qty: 1 }
    ])
    const headed = buildPreview(
      parseYgoList('Main Deck\n3 Pot of Greed\n1 Linkuriboh'),
      res,
      'text'
    )
    expect(keptEntries(headed, {})).toEqual([
      { section: 'main', card: POT, qty: 3 },
      { section: 'main', card: LINK, qty: 1 }
    ])
  })

  it('a line of more than 99 copies is not found, as typed, never cut to 99', () => {
    const p = buildPreview(
      parseYgoList('100 Pot of Greed'),
      [{ status: 'matched', card: POT, name: 'Pot of Greed', frameType: 'spell' }],
      'text'
    )
    expect(p.matched).toEqual([])
    expect(p.notFound).toMatchObject([
      { text: '100 Pot of Greed (more than 99 copies)', qty: 100, tooMany: true }
    ])
    expect(keptEntries(p, {})).toEqual([])
  })

  it('replace asks first', async () => {
    const api = pageApi(detail(), pack('2026-11-22'), {
      decks: { resolve: vi.fn(async () => [resolutions[0]]) }
    })
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, { api })
    await screen.findByText('Main Deck 42 / 40–60')
    await deckMenu('Replace from list')
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
  it('is after Binders for Pokémon too', async () => {
    const names = await nav('pkm')
    expect(names[names.indexOf('Binders') + 1]).toBe('Decks')
  })
})

describe('deck entry helpers', () => {
  const a: DeckEntry = { section: 'main', card: 1, qty: 2 }
  const b: DeckEntry = { section: 'side', card: 1, qty: 1 }
  const pinned: DeckEntry = { section: 'main', card: 1, printing: 'p1', qty: 1 }
  it('moveEntry moves an entry, or merges it into the same card and pin there', () => {
    expect(moveEntry([a, pinned], a, 'side')).toEqual([{ ...a, section: 'side' }, pinned])
    expect(moveEntry([a, b], a, 'side')).toEqual([{ section: 'side', card: 1, qty: 3 }])
    expect(moveEntry([b, pinned], pinned, 'side')).toEqual([
      b,
      { section: 'side', card: 1, printing: 'p1', qty: 1 }
    ])
    expect(moveEntry([a], a, 'main')).toEqual([a])
    expect(
      moveEntry(
        [
          { ...a, qty: 98 },
          { ...b, qty: 5 }
        ],
        b,
        'main'
      )
    ).toEqual([{ ...a, qty: 99 }])
  })
  it('changeSummary names the first new problem and how many more', () => {
    const p = (message: string) => ({ key: message, severity: 'error' as const, message })
    expect(changeSummary([])).toBeNull()
    expect(changeSummary([p('One')])).toBe('One')
    expect(changeSummary([p('One'), p('Two'), p('Three')])).toBe('One and 2 more')
  })
})

describe('Add to deck', () => {
  const LINK = 900
  const linkDetail = {
    card: { id: LINK, name: 'Link Thing', type: 'Link Monster', frameType: 'link' }
  } as CardDetail
  const addApi = (): Api =>
    pageApi(detail(), pack('2026-11-22'), {
      cards: { get: vi.fn(async () => linkDetail) },
      decks: { list: vi.fn(async () => ({ decks: [deck({})], cardFacts: facts })) }
    })

  it('Add to deck adds one copy to the default section', async () => {
    const api = addApi()
    renderWithProviders(<AddToDeck game="ygo" cardId={LINK} />, { api })
    // The deck list is read only once the menu opens.
    expect(api.decks.list).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Add to deck' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Deck' }))
    await waitFor(() =>
      expect(api.decks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: 'd1',
          notes: 'Side for the mirror',
          cards: [...legalCards, { section: 'extra', card: LINK, qty: 1 }]
        })
      )
    )
    expect(toast.success).toHaveBeenCalledWith('Added to Deck')
  })

  it('still adds a fourth copy and the toast names the problem', async () => {
    const api = addApi()
    renderWithProviders(<AddToDeck game="ygo" cardId={100} />, { api })
    await userEvent.click(screen.getByRole('button', { name: 'Add to deck' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Deck' }))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/^Added to Deck\. 4 × Filler 100: at most 3 copies/)
      )
    )
    expect(api.decks.save).toHaveBeenCalled()
  })
})

describe('the friend Decks tab', () => {
  const bob = {
    id: 7,
    username: 'bob',
    displayName: 'Bob',
    updatedAt: '2026-11-01T00:00:00Z'
  } as Friend
  const openFriend = (decks: DeckSummary[]): Api => {
    const api = apiWith(
      [],
      { state: 'missing' },
      {
        friends: {
          decks: vi.fn(async () => ({ decks, cardFacts: facts })),
          deck: vi.fn(async () => null)
        }
      }
    )
    renderWithProviders(<FriendBinder friend={bob} onBack={vi.fn()} />, { api })
    return api
  }

  it('friend Decks tab appears only when the friend has a visible deck', async () => {
    const api = openFriend([deck({ name: 'Theirs' })])
    await userEvent.click(await screen.findByRole('radio', { name: 'Decks' }))
    expect(api.friends.decks).toHaveBeenCalledWith(7)
    expect(await screen.findByText('Theirs')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New deck' })).not.toBeInTheDocument()
  })

  it('has no Decks tab when they share none', async () => {
    const api = openFriend([])
    await waitFor(() => expect(api.friends.decks).toHaveBeenCalled())
    expect(screen.queryByRole('radio', { name: 'Decks' })).not.toBeInTheDocument()
  })
})

describe('Pokémon on the deck screens', () => {
  const pkmCard = (id: number, name: string, type: string, owned = 0): DeckCard => ({
    id,
    name,
    type,
    frameType: 'pokemon',
    imageId: null,
    owned,
    price: null,
    regionPrice: null,
    sourceId: null,
    code: null,
    opNumber: null,
    opCardType: null,
    opColors: [],
    opCost: null,
    opBlock: null,
    mtgName: null,
    mtgTypeLine: null,
    mtgColorIdentity: [],
    mtgManaValue: null,
    mtgLayout: null
  })
  const browseCard = (id: number, name: string, type: string) =>
    ({
      id,
      name,
      type,
      frameType: 'pokemon',
      attribute: null,
      race: '',
      level: null,
      linkval: null,
      atk: null,
      def: null,
      imageId: 0,
      price: null,
      releasedAt: null,
      owned: 0,
      defaultPrintingId: null
    }) as never

  it('the adder offers Pokémon, Trainer and Energy chips, and Trainer keeps only Trainers', async () => {
    const api = createMockApi({
      cards: {
        browse: vi.fn(async () => ({
          cards: [
            browseCard(1, 'Pikachu', 'Pokémon'),
            browseCard(2, 'Iono', 'Trainer'),
            browseCard(3, 'Fire Energy', 'Energy')
          ],
          total: 3
        })),
        browseFacets: vi.fn(async () => ({
          cardTypes: ['Pokémon', 'Trainer', 'Energy'],
          attributes: [],
          races: [],
          archetypes: [],
          setNames: [],
          rarities: [],
          languages: []
        }))
      }
    })
    renderWithProviders(
      <DeckAdder
        game="pkm"
        format={DECK_FORMATS.pkm[0]}
        inDeck={new Map()}
        tab="add"
        onTab={vi.fn()}
        missingCount={0}
        missing={null}
        notes={null}
        onAdd={vi.fn()}
      />,
      { api }
    )
    const filters = await screen.findByRole('group', { name: 'Filters' })
    for (const n of ['Pokémon', 'Trainer', 'Energy'])
      expect(within(filters).getByRole('button', { name: n })).toBeInTheDocument()
    expect(within(filters).queryByRole('button', { name: 'Monster' })).not.toBeInTheDocument()
    await userEvent.click(within(filters).getByRole('button', { name: 'Trainer' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Iono' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add Pikachu' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add Fire Energy' })).not.toBeInTheDocument()
    })
  })

  it('the export menu has one item, Copy deck list, which copies PTCGL text', async () => {
    const copy = vi.fn(async (_text: string) => undefined)
    const api = createMockApi({ dex: { copy } })
    renderWithProviders(
      <ExportMenu
        game="pkm"
        name="Mine"
        cards={[{ section: 'main', card: 2, qty: 4 }]}
        facts={{ 2: { ...pkmCard(2, 'Iono', 'Trainer'), sourceId: 'en/sv2-185' } }}
      />,
      { api }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Copy deck list'])
    await userEvent.click(items[0])
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1))
    expect(copy.mock.calls[0][0]).toContain('4 Iono')
  })

  it('the import dialog previews 4 Iono PAL 185 as one line', async () => {
    const resolve = vi.fn(async () => [
      { status: 'matched' as const, card: 2, name: 'Iono', frameType: 'pokemon' }
    ])
    const api = createMockApi({ decks: { resolve } })
    renderWithProviders(
      <ImportDialog
        game="pkm"
        format="standard"
        busy={false}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
      { api }
    )
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Deck list'))
    await userEvent.paste('4 Iono PAL 185')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }))
    expect(await within(dialog).findByText('Matched (1)')).toBeInTheDocument()
    expect(within(dialog).getByText('4 Iono')).toBeInTheDocument()
    expect(resolve).toHaveBeenCalledWith([{ set: 'PAL', number: '185', name: 'Iono' }])
    expect(within(dialog).getByPlaceholderText(/Pokémon TCG Live/)).toBeInTheDocument()
  })
})

describe('One Piece on the deck screens', () => {
  const opCard = (
    id: number,
    name: string,
    opCardType: string,
    opNumber: string | null,
    opColors: string[] = ['Red']
  ): DeckCard => ({
    id,
    name,
    type: opCardType,
    frameType: 'op',
    imageId: null,
    owned: 0,
    price: null,
    regionPrice: null,
    sourceId: null,
    code: null,
    opNumber,
    opCardType,
    opColors,
    opCost: opCardType === 'Leader' ? null : 2,
    opBlock: 1,
    mtgName: null,
    mtgTypeLine: null,
    mtgColorIdentity: [],
    mtgManaValue: null,
    mtgLayout: null
  })
  const opBrowse = (id: number, name: string, type: string) =>
    ({
      id,
      name,
      type,
      frameType: 'op',
      attribute: null,
      race: '',
      level: null,
      linkval: null,
      atk: null,
      def: null,
      imageId: 0,
      price: null,
      releasedAt: null,
      owned: 0,
      defaultPrintingId: null
    }) as never
  const LUFFY = 501
  const NAMI = 502
  const opFacts: Record<number, DeckCard> = {
    [LUFFY]: opCard(LUFFY, 'Monkey.D.Luffy', 'Leader', 'OP01-001'),
    [NAMI]: opCard(NAMI, 'Nami', 'Character', 'OP01-016'),
    503: opCard(503, 'Promo Thing', 'Event', null)
  }
  const adder = (onAdd = vi.fn(), leaderColors: string[] = ['Red']): React.JSX.Element => (
    <DeckAdder
      game="op"
      format={DECK_FORMATS.op[0]}
      inDeck={new Map()}
      tab="add"
      onTab={vi.fn()}
      missingCount={0}
      missing={null}
      notes={null}
      onAdd={onAdd}
      leaderColors={leaderColors}
    />
  )

  it('the adder offers Character, Event, Stage and the Leader colours; Event filters by opCardTypes', async () => {
    const browse = vi.fn(async () => ({ cards: [], total: 0 }))
    renderWithProviders(adder(), { api: createMockApi({ cards: { browse } }) })
    const filters = await screen.findByRole('group', { name: 'Filters' })
    for (const n of ['Character', 'Event', 'Stage', 'Red'])
      expect(within(filters).getByRole('button', { name: n })).toBeInTheDocument()
    for (const n of ['Monster', 'Leader', 'DON!!', 'Pokémon'])
      expect(within(filters).queryByRole('button', { name: n })).not.toBeInTheDocument()
    // No type chip on: every playable type, never DON!!.
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ opCardTypes: ['Leader', 'Character', 'Event', 'Stage'] })
      )
    )
    await userEvent.click(within(filters).getByRole('button', { name: 'Event' }))
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ opCardTypes: ['Event'] }))
    )
    await userEvent.click(within(filters).getByRole('button', { name: 'Red' }))
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ opCardTypes: ['Event'], opColors: ['Red'] })
      )
    )
  })

  it('a Leader from the adder lands in Leader, a Character in the Deck', async () => {
    const onAdd = vi.fn()
    const api = createMockApi({
      cards: {
        browse: vi.fn(async () => ({
          cards: [opBrowse(LUFFY, 'Monkey.D.Luffy', 'Leader'), opBrowse(NAMI, 'Nami', 'Character')],
          total: 2
        }))
      }
    })
    renderWithProviders(adder(onAdd), { api })
    await userEvent.click(await screen.findByRole('button', { name: 'Add Monkey.D.Luffy' }))
    expect(onAdd).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: LUFFY, opCardType: 'Leader' }),
      'leader'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add Nami' }))
    expect(onAdd).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: NAMI, opCardType: 'Character' }),
      'main'
    )
  })

  it('Add to deck puts a Leader in Leader', async () => {
    const opDeck = deck({ game: 'op', format: 'standard', name: 'Straw Hats', cards: [] })
    const api = pageApi(
      detail({ ...opDeck, cardFacts: {} }),
      { state: 'missing' },
      {
        cards: {
          get: vi.fn(
            async () =>
              ({
                card: {
                  id: LUFFY,
                  name: 'Monkey.D.Luffy',
                  type: 'Leader',
                  frameType: 'op',
                  onePiece: {
                    cardType: 'Leader',
                    colors: ['Red'],
                    cost: null,
                    life: 5,
                    power: 5000,
                    counter: null,
                    attribute: [],
                    traits: [],
                    blockIcon: 1,
                    number: 'OP01-001'
                  }
                }
              }) as unknown as CardDetail
          )
        },
        decks: {
          list: vi.fn(async () => ({ decks: [opDeck], cardFacts: {} })),
          get: vi.fn(async () => ({ ...detail(opDeck), cardFacts: {} }))
        }
      }
    )
    renderWithProviders(<AddToDeck game="op" cardId={LUFFY} />, { api })
    await userEvent.click(screen.getByRole('button', { name: 'Add to deck' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Straw Hats' }))
    await waitFor(() =>
      expect(api.decks.save).toHaveBeenCalledWith(
        expect.objectContaining({ cards: [{ section: 'leader', card: LUFFY, qty: 1 }] })
      )
    )
  })

  it('Add to deck is hidden on a DON!! card and refuses one whose type it only learns on add', async () => {
    const DON = 600
    const opDeck = deck({ game: 'op', format: 'standard', name: 'Straw Hats', cards: [] })
    const donDetail = {
      card: {
        id: DON,
        name: 'DON!!',
        type: 'DON!!',
        frameType: 'op',
        onePiece: {
          cardType: 'DON!!',
          colors: [],
          cost: null,
          life: null,
          power: null,
          counter: null,
          attribute: [],
          traits: [],
          blockIcon: null,
          number: 'DON!!'
        }
      }
    } as unknown as CardDetail
    const api = pageApi(
      detail({ ...opDeck, cardFacts: {} }),
      { state: 'missing' },
      {
        cards: { get: vi.fn(async () => donDetail) },
        decks: {
          list: vi.fn(async () => ({ decks: [opDeck], cardFacts: {} })),
          get: vi.fn(async () => ({ ...detail(opDeck), cardFacts: {} }))
        }
      }
    )
    const { unmount } = renderWithProviders(<AddToDeck game="op" cardId={DON} cardType="DON!!" />, {
      api
    })
    expect(screen.queryByRole('button', { name: 'Add to deck' })).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<AddToDeck game="op" cardId={DON} />, { api })
    await userEvent.click(screen.getByRole('button', { name: 'Add to deck' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Straw Hats' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("DON!! cards don't go in a deck"))
    expect(api.decks.save).not.toHaveBeenCalled()
  })

  it('the deck page shows Leader above the Deck and passes the Leader colours to the adder', async () => {
    const opDetail = detail({
      game: 'op',
      format: 'standard',
      cards: [
        { section: 'leader', card: LUFFY, qty: 1 },
        { section: 'main', card: NAMI, qty: 4 }
      ],
      cardFacts: opFacts
    })
    renderWithProviders(<DeckPage uid="d1" onBack={vi.fn()} />, {
      api: pageApi(opDetail, { state: 'missing' })
    })
    const leader = await screen.findByRole('region', { name: 'Leader' })
    const main = screen.getByRole('region', { name: 'Deck' })
    expect(within(leader).getByText('Monkey.D.Luffy')).toBeInTheDocument()
    expect(within(leader).getByText('Leader 1 / 1')).toBeInTheDocument()
    expect(leader.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const filters = screen.getAllByRole('group', { name: 'Filters' })[0]
    expect(within(filters).getByRole('button', { name: 'Red' })).toBeInTheDocument()
  })

  it('the export menu copies the list, the OPlay code and the OPlay link, leaving out cards without a number', async () => {
    const copy = vi.fn(async (_text: string) => undefined)
    const api = createMockApi({ dex: { copy } })
    const cards: DeckEntry[] = [
      { section: 'leader', card: LUFFY, qty: 1 },
      { section: 'main', card: NAMI, qty: 4 },
      { section: 'main', card: 503, qty: 2 }
    ]
    renderWithProviders(<ExportMenu game="op" name="Mine" cards={cards} facts={opFacts} />, {
      api
    })
    const open = async (): Promise<HTMLElement[]> => {
      await userEvent.click(screen.getByRole('button', { name: 'Export' }))
      return screen.findAllByRole('menuitem')
    }
    const items = await open()
    expect(items.map((i) => i.textContent)).toEqual([
      'Copy deck list',
      'Copy OPlay deck code',
      'Copy OPlay link'
    ])
    const code = encodeOplayV2({ leader: 'OP01-001', entries: [{ code: 'OP01-016', qty: 4 }] })
    await userEvent.click(items[1])
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith(code))
    expect(toast.success).toHaveBeenLastCalledWith(
      'Copied the OPlay deck code. 1 card left out — try again in a moment.'
    )
    await userEvent.click((await open())[2])
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith(oplayLink(code)))
    await userEvent.click((await open())[0])
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith(toOpText(cards, opFacts)))
  })

  const opImport = (
    resolve: Api['decks']['resolve'],
    onApply = vi.fn()
  ): { api: Api; onApply: ReturnType<typeof vi.fn> } => {
    const api = createMockApi({ decks: { resolve } })
    renderWithProviders(
      <ImportDialog game="op" format="standard" busy={false} onApply={onApply} onClose={vi.fn()} />,
      { api }
    )
    return { api, onApply }
  }
  const pasteOp = async (text: string): Promise<HTMLElement> => {
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Deck list'))
    await userEvent.paste(text)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview' }))
    return dialog
  }

  it('the import dialog previews 1xOP01-001 and 4xOP01-016 with the Leader in Leader', async () => {
    const resolve = vi.fn(async () => [
      {
        status: 'matched' as const,
        card: LUFFY,
        name: 'Monkey.D.Luffy',
        frameType: 'op',
        opCardType: 'Leader'
      },
      {
        status: 'matched' as const,
        card: NAMI,
        name: 'Nami',
        frameType: 'op',
        opCardType: 'Character'
      }
    ])
    const { onApply } = opImport(resolve)
    const dialog = await pasteOp('1xOP01-001\n4xOP01-016')
    expect(await within(dialog).findByText('Matched (2)')).toBeInTheDocument()
    expect(resolve).toHaveBeenCalledWith([
      { opNumber: 'OP01-001', name: '' },
      { opNumber: 'OP01-016', name: '' }
    ])
    expect(
      within(dialog).getByPlaceholderText('Paste a deck list, an OPlay deck code or share link')
    ).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Deck file')).toHaveAttribute('accept', '.txt')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import deck' }))
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        cards: [
          { section: 'leader', card: LUFFY, qty: 1 },
          { section: 'main', card: NAMI, qty: 4 }
        ]
      })
    )
  })

  it('a ?deck= link shows the OPlay message', async () => {
    const resolve = vi.fn(async () => [])
    opImport(resolve)
    const dialog = await pasteOp('https://oplaytcg.com/en/deck-builder?deck=1')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That link points to a deck saved on OPlay. Open it there and copy its deck code or share link instead.'
    )
    expect(resolve).not.toHaveBeenCalled()
  })

  it('a Magic Companion or Sideboard line is left out of a Commander deck, a pin is kept', () => {
    const parsed = parseMtgText(
      'Commander\n1 Krenko\n\nCompanion\n1 Lurrus\n\nDeck\n1 Lightning Bolt (2X2) 117'
    )
    const res: DeckResolution[] = [
      { status: 'matched', card: 1, name: 'Krenko', frameType: 'mtg' },
      { status: 'matched', card: 2, name: 'Lurrus', frameType: 'mtg' },
      {
        status: 'matched',
        card: 3,
        name: 'Lightning Bolt',
        frameType: 'mtg',
        printing: 'en|3|2X2 117|U'
      }
    ]
    const commander = buildPreview(parsed, res, 'text', 'mtg', 'commander')
    expect(commander.notFound).toMatchObject([
      { text: '1 Lurrus (Commander decks here have no sideboard)', leftOut: expect.any(String) }
    ])
    expect(keptEntries(commander, {})).toEqual([
      { section: 'commander', card: 1, qty: 1 },
      { section: 'main', card: 3, printing: 'en|3|2X2 117|U', qty: 1 }
    ])
    const modern = buildPreview(parsed, res, 'text', 'mtg', 'modern')
    expect(modern.notFound).toEqual([])
    expect(keptEntries(modern, {}).map((e) => e.section)).toEqual(['commander', 'side', 'main'])
  })

  it('the import ignores a DON!! card that matched by number', () => {
    const parsed = parseOpText('1xOP01-001\n10xDON-001\n4xOP01-016')
    const preview = buildPreview(
      parsed,
      [
        { status: 'matched', card: LUFFY, name: 'Luffy', frameType: 'op', opCardType: 'Leader' },
        { status: 'matched', card: 9, name: 'DON!! Card', frameType: 'op', opCardType: 'DON!!' },
        { status: 'matched', card: NAMI, name: 'Nami', frameType: 'op', opCardType: 'Character' }
      ],
      'text',
      'op'
    )
    expect(preview.matched.map((m) => [m.card, m.section])).toEqual([
      [LUFFY, 'leader'],
      [NAMI, 'main']
    ])
    expect(preview.notFound).toEqual([])
    expect(preview.ambiguous).toEqual([])
  })
})
