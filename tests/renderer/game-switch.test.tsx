import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { CardDetails } from '@/components/CardDetails'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { GAME_FREE, GameProvider, pageInGame, useGame } from '@/lib/game'
import { SetsPage } from '@/features/sets/SetsPage'
import { createHttpApi, GAME_KEY } from '@/web/httpApi'
import { App as PhoneApp } from '../../src/phone/App'
import type { DataChannel } from '../../src/main/ipc/dataHandlers'
import { GameSegments } from '@/components/GameSwitch'
import { GAMES, type GameId } from '@shared/games'
import type { Api } from '@shared/ipc'
import type { AccountStatus, CardRow } from '@shared/types'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'
import { fakeStore, installPhoneApi, json, setOnline, stubFetch } from './phoneFakes'
import { fakeEngine, stubCamera, stubVideo } from './scanFakes'

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

/** The desktop mock api, signed in, with these games. */
function desktopApi(available: GameId[], active: GameId = 'ygo', o: DeepPartial<Api> = {}): Api {
  return createMockApi({
    ...o,
    account: { status: async () => signedIn, ...o.account },
    games: {
      available: vi.fn(async () => available),
      active: vi.fn(async () => active),
      setActive: vi.fn(async () => undefined),
      ...o.games
    }
  })
}

async function renderDesktop(api: Api): Promise<void> {
  renderWithProviders(<App />, { api })
  await screen.findByRole('navigation', { name: 'Main' })
}

const navNames = (): (string | null)[] =>
  within(screen.getByRole('navigation', { name: 'Main' }))
    .getAllByRole('button')
    .map((b) => b.textContent)

const pkmFacets = {
  cardTypes: [],
  attributes: [],
  archetypes: [],
  setNames: ['Paldea Evolved'],
  rarities: ['Normal', 'Reverse Holofoil'],
  languages: ['en' as const],
  pkmCategories: ['Pokémon', 'Trainer'],
  pkmTypes: ['Fire'],
  pkmStages: ['Basic']
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
  localStorage.clear()
})

describe('desktop game switch', () => {
  it('is not in the DOM with only Yu-Gi-Oh!', async () => {
    await renderDesktop(desktopApi(['ygo']))
    expect(screen.queryByRole('button', { name: /switch game/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Yu-Gi-Oh!')).not.toBeInTheDocument()
    expect(navNames()).toContain('Scan')
    expect(navNames()).not.toContain('Rip')
  })

  it('shows both games and choosing Pokémon sets it active', async () => {
    const api = desktopApi(['ygo', 'pkm'])
    await renderDesktop(api)
    const trigger = await screen.findByRole('button', { name: /switch game/i })
    expect(trigger).toHaveTextContent('Yu-Gi-Oh!')
    await userEvent.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: /Yu-Gi-Oh!/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /Pokémon/ }))
    expect(api.games.setActive).toHaveBeenCalledWith('pkm')
  })

  it('three games in the sidebar menu', async () => {
    const api = desktopApi(['ygo', 'pkm', 'op'])
    await renderDesktop(api)
    await userEvent.click(await screen.findByRole('button', { name: /switch game/i }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3)
    expect(within(menu).getByRole('menuitemradio', { name: /Yu-Gi-Oh!/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: /Pokémon/ })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /One Piece/ }))
    expect(api.games.setActive).toHaveBeenCalledWith('op')
  })

  it('three phone segments, only the active one checked', async () => {
    renderWithProviders(
      <GameProvider>
        <GameSegments />
      </GameProvider>,
      { api: desktopApi(['ygo', 'pkm', 'op'], 'op') }
    )
    const group = await screen.findByRole('radiogroup', { name: 'Game' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    await waitFor(() =>
      expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    )
    expect(radios[2]).toHaveTextContent('One Piece')
    // Three games keep the single-row layout, exactly as before Magic.
    for (const r of radios) {
      expect(r).toHaveClass('h-10')
      expect(r).not.toHaveClass('h-12')
      expect(r).not.toHaveClass('flex-col')
      expect(r.querySelector('.truncate')).toBeNull()
    }
  })

  it('four games in the sidebar menu, Magic among them', async () => {
    const api = desktopApi(['ygo', 'pkm', 'op', 'mtg'])
    await renderDesktop(api)
    await userEvent.click(await screen.findByRole('button', { name: /switch game/i }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(4)
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /Magic/ }))
    expect(api.games.setActive).toHaveBeenCalledWith('mtg')
  })

  it('four phone segments, only the active one checked, labels that truncate', async () => {
    renderWithProviders(
      <GameProvider>
        <GameSegments />
      </GameProvider>,
      { api: desktopApi(['ygo', 'pkm', 'op', 'mtg'], 'mtg') }
    )
    const group = await screen.findByRole('radiogroup', { name: 'Game' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(4)
    await waitFor(() =>
      expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
        'false',
        'false',
        'false',
        'true'
      ])
    )
    expect(radios[3]).toHaveTextContent('Magic')
    for (const r of radios) {
      expect(r).toHaveClass('h-12', 'flex-col')
      expect(r.querySelector('.truncate')).not.toBeNull()
    }
  })

  it('Magic hides Scan and the Pokédex', async () => {
    await renderDesktop(desktopApi(['ygo', 'pkm', 'op', 'mtg'], 'mtg'))
    expect(await screen.findByRole('button', { name: /switch game/i })).toHaveTextContent('Magic')
    expect(navNames()).not.toContain('Scan')
    expect(navNames()).not.toContain('Pokédex')
    expect(pageInGame('scan', GAMES.mtg)).toBe(false)
    expect(pageInGame('pokedex', GAMES.mtg)).toBe(false)
    expect(pageInGame('sets', GAMES.mtg)).toBe(true)
  })

  it('op shows Scan', async () => {
    await renderDesktop(desktopApi(['ygo', 'pkm', 'op'], 'op'))
    expect(await screen.findByRole('button', { name: /switch game/i })).toHaveTextContent(
      'One Piece'
    )
    expect(navNames()).toContain('Scan')
  })

  it('Pokémon shows Scan', async () => {
    await renderDesktop(desktopApi(['ygo', 'pkm'], 'pkm'))
    expect(await screen.findByRole('button', { name: /switch game/i })).toHaveTextContent('Pokémon')
    expect(navNames()).toContain('Scan')
    expect(pageInGame('scan', GAMES.pkm)).toBe(true)
    // Scan and its Sessions leave a game without Scan; the rest stay.
    const noScan = { ...GAMES.pkm, features: { scan: false, pokedex: true } }
    expect(pageInGame('scan', noScan)).toBe(false)
    expect(pageInGame('sessions', noScan)).toBe(false)
    expect(pageInGame('sets', noScan)).toBe(true)
  })

  it('the Pokédex is in Pokémon only', async () => {
    expect(pageInGame('pokedex', GAMES.pkm)).toBe(true)
    expect(pageInGame('pokedex', GAMES.ygo)).toBe(false)
    expect(pageInGame('pokedex', GAMES.op)).toBe(false)
    await renderDesktop(desktopApi(['ygo', 'pkm'], 'pkm'))
    await screen.findByRole('button', { name: /switch game/i })
    await waitFor(() => expect(navNames()).toContain('Pokédex'))
    // Right after Binders, in My cards.
    const names = navNames()
    expect(names[names.indexOf('Binders') + 1]).toBe('Pokédex')
  })

  it('Yu-Gi-Oh! has no Pokédex', async () => {
    await renderDesktop(desktopApi(['ygo', 'pkm'], 'ygo'))
    await screen.findByRole('button', { name: /switch game/i })
    expect(navNames()).not.toContain('Pokédex')
  })

  it('shows Yu-Gi-Oh! and asks main for it when the game cannot be read', async () => {
    const api = desktopApi(['ygo', 'pkm'], 'pkm', {
      games: { active: vi.fn(async () => Promise.reject(new Error('IPC failed'))) }
    })
    await renderDesktop(api)
    expect(navNames()).toContain('Scan')
    expect(screen.queryByRole('button', { name: /switch game/i })).not.toBeInTheDocument()
    await waitFor(() => expect(api.games.setActive).toHaveBeenCalledWith('ygo'))
    expect(api.games.setActive).toHaveBeenCalledTimes(1)
  })

  /** Desktop with Yu-Gi-Oh! (1234 cards) and Pokémon (none); main says data changed on a switch. */
  function switchingApi(ygoStats: () => Promise<number>): {
    api: Api
    choose: (g: string) => Promise<void>
    accountChanged: () => void
  } {
    const changed: (() => void)[] = []
    const onAccount: ((s: AccountStatus) => void)[] = []
    let active: GameId = 'ygo'
    const base = createMockApi({})
    const api = desktopApi(['ygo', 'pkm'], 'ygo', {
      account: {
        onChange: vi.fn((cb: (s: AccountStatus) => void) => {
          onAccount.push(cb)
          return () => {}
        })
      },
      app: {
        onDataChanged: vi.fn((cb: () => void) => {
          changed.push(cb)
          return () => {}
        })
      },
      games: {
        active: vi.fn(async () => active),
        setActive: vi.fn(async (g: GameId) => {
          active = g
          for (const cb of changed) cb()
        })
      },
      stats: {
        get: vi.fn(async () => {
          const empty = await base.stats.get()
          return { ...empty, totalCards: active === 'ygo' ? await ygoStats() : 0 }
        })
      }
    })
    const choose = async (g: string): Promise<void> => {
      await userEvent.click(await screen.findByRole('button', { name: /switch game/i }))
      await userEvent.click(await screen.findByRole('menuitemradio', { name: new RegExp(g) }))
    }
    const accountChanged = (): void => {
      for (const cb of onAccount) cb(signedIn)
    }
    return { api, choose, accountChanged }
  }

  it('switching back shows the game as it was left while it refetches', async () => {
    let ygo = (): Promise<number> => Promise.resolve(1234)
    const { api, choose } = switchingApi(() => ygo())
    await renderDesktop(api)
    expect(await screen.findByText('1234')).toBeInTheDocument()
    await choose('Pokémon')
    expect(await screen.findByText('Your collection is empty')).toBeInTheDocument()
    ygo = () => new Promise(() => {})
    await choose('Yu-Gi-Oh!')
    expect(await screen.findByText('1234')).toBeInTheDocument()
    expect(screen.queryByText('Your collection is empty')).not.toBeInTheDocument()
  })

  it("an account change forgets the games' last pages", async () => {
    let ygo = (): Promise<number> => Promise.resolve(1234)
    const { api, choose, accountChanged } = switchingApi(() => ygo())
    await renderDesktop(api)
    await screen.findByText('1234')
    await choose('Pokémon')
    await screen.findByText('Your collection is empty')
    act(() => accountChanged())
    ygo = () => new Promise(() => {})
    await choose('Yu-Gi-Oh!')
    await waitFor(() =>
      expect(screen.queryByText('Your collection is empty')).not.toBeInTheDocument()
    )
    expect(screen.queryByText('1234')).not.toBeInTheDocument()
  })

  it('a switch reads each page once, not again for the data-changed it sets off', async () => {
    const { api, choose } = switchingApi(() => Promise.resolve(1234))
    // The app's staleTime, so a page remounting on its fresh rows doesn't read them again.
    renderWithProviders(<App />, { api, staleTime: 30_000 })
    await screen.findByText('1234')
    const before = vi.mocked(api.stats.get).mock.calls.length
    await choose('Pokémon')
    await screen.findByText('Your collection is empty')
    await new Promise((r) => setTimeout(r, 50))
    expect(vi.mocked(api.stats.get).mock.calls.length - before).toBe(1)
  })

  it('pins the query roots a game switch keeps', () => {
    expect([...GAME_FREE]).toEqual(['account', 'sync', 'me', 'update', 'app', 'images', 'phone'])
  })

  it("reads the game before the first page's queries", async () => {
    let answer: (g: GameId) => void = () => {}
    const api = desktopApi(['ygo', 'pkm'], 'pkm', {
      games: { active: vi.fn(() => new Promise<GameId>((r) => (answer = r))) }
    })
    renderWithProviders(<App />, { api })
    await waitFor(() => expect(api.games.active).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(api.stats.get).not.toHaveBeenCalled()
    await act(async () => answer('pkm'))
    await screen.findByRole('navigation', { name: 'Main' })
    await waitFor(() => expect(api.stats.get).toHaveBeenCalled())
  })

  it('re-reads the game after an account change and reloads the pages', async () => {
    const onAccount: ((s: AccountStatus) => void)[] = []
    let active: GameId = 'pkm'
    const api = desktopApi(['ygo', 'pkm'], 'pkm', {
      games: { active: vi.fn(async () => active) },
      account: {
        onChange: vi.fn((cb: (s: AccountStatus) => void) => {
          onAccount.push(cb)
          return () => {}
        })
      }
    })
    await renderDesktop(api)
    await waitFor(() => expect(api.stats.get).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /switch game/i })).toHaveTextContent('Pokémon')
    const reads = vi.mocked(api.stats.get).mock.calls.length
    // Signing in as someone without Pokémon resets the game in main.
    active = 'ygo'
    vi.mocked(api.games.available).mockResolvedValue(['ygo'])
    await act(async () => {
      for (const cb of onAccount) cb(signedIn)
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /switch game/i })).not.toBeInTheDocument()
    )
    await waitFor(() => expect(vi.mocked(api.stats.get).mock.calls.length).toBeGreaterThan(reads))
  })
})

describe('per-game filters and words', () => {
  const pkmApi = (list = vi.fn(async () => [])): Api =>
    desktopApi(['ygo', 'pkm'], 'pkm', {
      collection: { facets: async () => pkmFacets, list },
      cards: {
        browseFacets: async () => ({ ...pkmFacets, races: [] })
      }
    })

  it('the collection filters show Category, Type, Stage and HP on Pokémon', async () => {
    renderWithProviders(
      <GameProvider>
        <CollectionPage />
      </GameProvider>,
      { api: pkmApi() }
    )
    await userEvent.click(await screen.findByRole('button', { name: /^Filters/ }))
    expect(await screen.findByRole('button', { name: /Category/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Type/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stage/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Version/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'HP' }))
    expect(screen.getByLabelText('HP min')).toBeInTheDocument()
    expect(screen.getByLabelText('HP max')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Attribute/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Card type/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Level' })).not.toBeInTheDocument()
  })

  it('a Pokémon HP bound goes to hpMin', async () => {
    const list = vi.fn(async () => [])
    renderWithProviders(
      <GameProvider>
        <CollectionPage />
      </GameProvider>,
      { api: pkmApi(list) }
    )
    await userEvent.click(await screen.findByRole('button', { name: /^Filters/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'HP' }))
    await userEvent.type(screen.getByLabelText('HP min'), '9')
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ hpMin: 9 }))
    )
  })

  it('Browse builds its filters and sorts from the game too', async () => {
    renderWithProviders(
      <GameProvider>
        <BrowsePage onAddCard={() => {}} />
      </GameProvider>,
      { api: pkmApi() }
    )
    await userEvent.click(await screen.findByRole('combobox', { name: 'Sort by' }))
    expect(await screen.findByRole('option', { name: 'HP: high to low' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^ATK/ })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    expect(await screen.findByRole('button', { name: /Category/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stage/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HP' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Attribute/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Level' })).not.toBeInTheDocument()
  })

  it('card details label the printing code "Number" and the rarity "Version" on Pokémon', async () => {
    const card: CardRow = {
      id: 2 ** 40 + 1,
      name: 'Charizard ex',
      type: 'Pokémon',
      frameType: '',
      race: '',
      attribute: null,
      level: null,
      linkval: null,
      atk: null,
      def: null,
      archetype: null,
      desc: '',
      tcgplayerPrice: null
    }
    renderWithProviders(
      <GameProvider>
        <CardDetails
          card={card}
          printing={{ setCode: 'PAL 054/193', setRarity: 'Reverse Holofoil' }}
        />
      </GameProvider>,
      { api: pkmApi() }
    )
    const number = await screen.findByText('Number')
    expect(number.nextElementSibling).toHaveTextContent('PAL 054/193')
    expect(screen.getByText('Version').nextElementSibling).toHaveTextContent('Reverse Holofoil')
  })

  it("card details list a Pokémon card's own facts, skipping empty ones, then its text", async () => {
    const card: CardRow = {
      id: 2 ** 40 + 2,
      name: 'Pineco',
      type: 'Pokémon',
      frameType: '',
      race: '',
      attribute: null,
      level: null,
      linkval: null,
      atk: null,
      def: null,
      archetype: null,
      desc: 'It likes to hang from trees.',
      tcgplayerPrice: null,
      pokemon: {
        category: 'Pokémon',
        hp: 60,
        types: ['Grass', 'Fighting'],
        stage: 'Basic',
        rarity: 'Common',
        illustrator: null,
        localName: 'マツボックリ'
      }
    }
    renderWithProviders(
      <GameProvider>
        <CardDetails card={card} printing={{ setCode: 'SVI 045/198', setRarity: 'Normal' }} />
      </GameProvider>,
      { api: pkmApi() }
    )
    const fact = async (label: string): Promise<HTMLElement | null> =>
      (await screen.findByText(label)).nextElementSibling as HTMLElement | null
    expect(await fact('HP')).toHaveTextContent('60')
    expect(await fact('Type')).toHaveTextContent('Grass, Fighting')
    expect(await fact('Stage')).toHaveTextContent('Basic')
    expect(await fact('Rarity')).toHaveTextContent('Common')
    expect(await fact('Local name')).toHaveTextContent('マツボックリ')
    expect(await fact('Version')).toHaveTextContent('Normal')
    expect(screen.queryByText('Illustrator')).not.toBeInTheDocument()
    expect(screen.getByText('It likes to hang from trees.')).toBeInTheDocument()
  })

  it('keeps the saved set types per game, with Yu-Gi-Oh! on the old key', async () => {
    localStorage.setItem('sets.types', '["deck"]')
    localStorage.setItem('sets.types:pkm', '["promo"]')
    renderWithProviders(
      // As the app does: no page renders before the game is known.
      <GameProvider fallback={null}>
        <SetsPage onAddCard={() => {}} onAddMissing={() => {}} />
      </GameProvider>,
      { api: pkmApi() }
    )
    expect(await screen.findByText('Promos')).toBeInTheDocument()
    expect(screen.queryByText('Decks')).not.toBeInTheDocument()
  })

  it('card details on Yu-Gi-Oh! stay as they are', () => {
    const card: CardRow = {
      id: 46986414,
      name: 'Dark Magician',
      type: 'Normal Monster',
      frameType: 'normal',
      race: 'Spellcaster',
      attribute: 'DARK',
      level: 7,
      linkval: null,
      atk: 2500,
      def: 2100,
      archetype: null,
      desc: 'The ultimate wizard.',
      tcgplayerPrice: null
    }
    renderWithProviders(
      <CardDetails card={card} printing={{ setCode: 'LOB-EN005', setRarity: 'Ultra Rare' }} />
    )
    expect(screen.getByText('ATK 2500 · DEF 2100 · Level 7')).toBeInTheDocument()
    expect(screen.queryByText('Set code')).not.toBeInTheDocument()
    expect(screen.queryByText('LOB-EN005')).not.toBeInTheDocument()
  })
})

/** A Storage stand-in over a Map. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

/** A portal for createHttpApi: `/api/me` answers with `me` (or `status`), RPCs record their game header. */
function webPortal(
  me: object,
  status = 200
): { fetch: typeof globalThis.fetch; headers: string[] } {
  const headers: string[] = []
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/me') return json(me, status)
    headers.push((init?.headers as Record<string, string>)['x-duel-game'])
    return json({ result: [] })
  }) as unknown as typeof globalThis.fetch
  return { fetch, headers }
}

const OWNER = {
  id: 1,
  username: 'seto',
  displayName: 'Seto',
  avatarUrl: null,
  games: ['ygo', 'pkm']
}
const listArgs = { sort: 'added', dir: 'desc' } as const

function GameProbe(): React.JSX.Element {
  return <p data-testid="game">{useGame().def.name}</p>
}

describe('web game header', () => {
  it('sends Yu-Gi-Oh! and shows it when a remembered game cannot be checked', async () => {
    const storage = memoryStorage()
    storage.setItem(GAME_KEY, 'pkm')
    const { fetch, headers } = webPortal({ error: 'boom' }, 500)
    const api = createHttpApi({ fetch, storage, onSignedOut: () => {} })
    await api.collection.list(listArgs)
    expect(headers).toEqual(['ygo'])
    renderWithProviders(
      <GameProvider>
        <GameProbe />
      </GameProvider>,
      { api: Object.assign(createMockApi(), { games: api.games }) }
    )
    expect(await screen.findByTestId('game')).toHaveTextContent('Yu-Gi-Oh!')
    await expect(api.games.active()).resolves.toBe('ygo')
    await api.collection.list(listArgs)
    expect(headers).toEqual(['ygo', 'ygo'])
    // Still remembered for the next load, when the check may work.
    expect(storage.getItem(GAME_KEY)).toBe('pkm')
  })

  it("keeps the tab's own game when another tab changes storage", async () => {
    const storage = memoryStorage()
    const { fetch, headers } = webPortal(OWNER)
    const api = createHttpApi({ fetch, storage, onSignedOut: () => {} })
    await api.collection.list(listArgs)
    // Another tab switches to Pokémon.
    storage.setItem(GAME_KEY, 'pkm')
    await api.collection.list(listArgs)
    await expect(api.games.active()).resolves.toBe('ygo')
    // This tab switches; another tab switching back doesn't move it.
    await api.games.setActive('pkm')
    storage.setItem(GAME_KEY, 'ygo')
    await api.collection.list(listArgs)
    expect(headers).toEqual(['ygo', 'ygo', 'pkm'])
  })

  it('checks a remembered non-Yu-Gi-Oh! game before the first RPC sends it', async () => {
    const storage = new Map<string, string>()
    const store = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v)
    }
    // Left by the owner in a shared browser; this visitor can't see Pokémon.
    store.setItem(GAME_KEY, 'pkm')
    const headers: string[] = []
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/me')
        return json({ id: 2, username: 'joey', displayName: 'Joey', avatarUrl: null })
      headers.push((init?.headers as Record<string, string>)['x-duel-game'])
      return json({ result: [] })
    }) as unknown as typeof globalThis.fetch
    const api = createHttpApi({ fetch, storage: store, onSignedOut: () => {} })
    await api.collection.list({ sort: 'added', dir: 'desc' })
    expect(headers).toEqual(['ygo'])
    expect(store.getItem(GAME_KEY)).toBe('ygo')
  })

  it('sends a remembered Yu-Gi-Oh! without asking first', async () => {
    const fetch = vi.fn(async () => json({ result: [] })) as unknown as typeof globalThis.fetch
    const api = createHttpApi({ fetch, storage: memoryStorage(), onSignedOut: () => {} })
    await api.collection.list({ sort: 'added', dir: 'desc' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('phone game switch', () => {
  beforeEach(() => {
    stubVideo()
    stubCamera()
    setOnline(true)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: vi.fn(async () => true), persisted: vi.fn(async () => true) }
    })
    stubFetch({ '/api/me': () => json({ error: 'unauthorized' }, 401) })
    window.history.replaceState(null, '', '/scan/')
  })

  /** A fake phone store whose games channels answer from `games`. */
  function phoneStore(games: {
    available: GameId[]
    active: GameId
  }): ReturnType<typeof fakeStore> {
    const store = fakeStore()
    const invoke = store.invoke
    store.invoke = vi.fn(async (channel: DataChannel, args: unknown[]) => {
      if (channel === 'games:available') return games.available
      if (channel === 'games:active') return games.active
      if (channel === 'games:setActive') {
        games.active = args[0] as GameId
        return undefined
      }
      return invoke(channel, args)
    }) as typeof store.invoke
    return store
  }

  const renderPhone = (store: ReturnType<typeof fakeStore>): void => {
    installPhoneApi(store)
    const engine = fakeEngine()
    render(<PhoneApp store={store} onFatal={() => () => {}} engineFactory={() => engine} />)
  }
  const tabs = async (): Promise<HTMLElement> => screen.findByRole('navigation', { name: 'Tabs' })

  it('shows no chip and no switch with only Yu-Gi-Oh!', async () => {
    renderPhone(phoneStore({ available: ['ygo'], active: 'ygo' }))
    const nav = await tabs()
    await userEvent.click(within(nav).getByRole('button', { name: 'Collection' }))
    await screen.findByRole('heading', { name: 'Collection' })
    expect(screen.queryByRole('button', { name: /switch game/i })).not.toBeInTheDocument()
    await userEvent.click(within(nav).getByRole('button', { name: 'More' }))
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    expect(within(sheet).queryByRole('radiogroup', { name: 'Game' })).not.toBeInTheDocument()
  })

  it('puts the game chip in the page header and a switch in More', async () => {
    const store = phoneStore({ available: ['ygo', 'pkm'], active: 'ygo' })
    renderPhone(store)
    const nav = await tabs()
    await userEvent.click(within(nav).getByRole('button', { name: 'Collection' }))
    await screen.findByRole('heading', { name: 'Collection' })
    expect(screen.getByRole('button', { name: /switch game/i })).toHaveTextContent('Yu-Gi-Oh!')
    await userEvent.click(within(nav).getByRole('button', { name: 'More' }))
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    expect(within(nav).getByRole('button', { name: 'Scan', hidden: true })).toBeInTheDocument()
    const group = within(sheet).getByRole('radiogroup', { name: 'Game' })
    expect(within(group).getByRole('radio', { name: /Yu-Gi-Oh!/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(within(group).getByRole('radio', { name: /Pokémon/ }))
    expect(store.invoke).toHaveBeenCalledWith('games:setActive', ['pkm'])
    // On Pokémon (the owner's) the raised Scan tab stays (the open sheet hides the tabs).
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: /Pokémon/ })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    )
    expect(within(nav).getByRole('button', { name: 'Scan', hidden: true })).toBeInTheDocument()
    expect(within(nav).getAllByRole('button', { hidden: true })).toHaveLength(5)
  })

  it('the chip shows the game being switched to, with a spinner, until the switch lands', async () => {
    const store = phoneStore({ available: ['ygo', 'pkm'], active: 'ygo' })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const answer = store.invoke
    store.invoke = vi.fn(async (channel: DataChannel, args: unknown[]) => {
      if (channel === 'games:setActive') await gate
      return answer(channel, args)
    }) as typeof store.invoke
    renderPhone(store)
    const nav = await tabs()
    await userEvent.click(within(nav).getByRole('button', { name: 'Collection' }))
    await screen.findByRole('heading', { name: 'Collection' })
    await userEvent.click(screen.getByRole('button', { name: 'Switch game, showing Yu-Gi-Oh!' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Pokémon/ }))
    const busy = await screen.findByRole('button', { name: 'Switching game to Pokémon' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    release()
    const done = await screen.findByRole('button', { name: 'Switch game, showing Pokémon' })
    expect(done).not.toHaveAttribute('aria-busy')
  })

  it('closing Contribute photos goes back to the game shown before', async () => {
    const store = phoneStore({ available: ['ygo', 'op'], active: 'ygo' })
    renderPhone(store)
    const nav = await tabs()
    await userEvent.click(within(nav).getByRole('button', { name: 'More' }))
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Settings' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Contribute photos' }))
    expect(store.invoke).toHaveBeenCalledWith('games:setActive', ['op'])
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    const switches = (): unknown[] =>
      vi
        .mocked(store.invoke)
        .mock.calls.filter((c) => c[0] === 'games:setActive')
        .map((c) => c[1])
    await waitFor(() => expect(switches()).toEqual([['op'], ['ygo']]))
  })
})
