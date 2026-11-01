import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { CardArt } from '@/components/CardArt'
import type { Api } from '@shared/ipc'
import type { EntryView } from '@shared/types'
import { createMockApi, renderWithProviders } from './mockApi'
import { flushUsage, resetUsage } from '@/lib/usage'

// Signed in, so the sign-in gate lets the shell through.
const mockApi = (o: Parameters<typeof createMockApi>[0] = {}): Api =>
  createMockApi({
    ...o,
    account: {
      status: async () => ({
        state: 'idle' as const,
        user: { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null },
        localOwner: 'Seto',
        lastSyncedAt: null,
        error: null,
        pendingCount: 0,
        unsyncedCount: 0,
        signInRequired: true
      })
    }
  })

async function renderApp(api: Api = mockApi()): Promise<ReturnType<typeof renderWithProviders>> {
  const result = renderWithProviders(<App />, { api })
  await screen.findByRole('navigation', { name: 'Main' })
  return result
}

const status = (o: object = {}) => ({
  state: 'idle' as const,
  lastSyncAt: null,
  dbVersion: null,
  cardCount: 100,
  error: null,
  blocked: null,
  blockedRetry: null,
  ...o
})

describe('AppShell', () => {
  it('navigation switches pages', async () => {
    await renderApp()
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collection' }))
    expect(screen.getByRole('heading', { name: 'Collection' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  })

  it('counts the open and each page shown toward the anonymous usage report', async () => {
    resetUsage()
    const api = mockApi()
    await renderApp(api)
    await userEvent.click(screen.getByRole('button', { name: 'Sets' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    flushUsage()
    expect(api.usage.report).toHaveBeenCalledWith({ open: 1, 'page:dashboard': 2, 'page:sets': 1 })
  })

  it('Ctrl+K and the Add card button open the add flow', async () => {
    await renderApp()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByPlaceholderText(/Search cards/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Add card/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('AppShell sets nav', () => {
  it('lists Sets between Collection and Settings and opens it', async () => {
    await renderApp()
    const names = within(screen.getByRole('navigation', { name: 'Main' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names).toEqual([
      'Dashboard',
      'Collection',
      'Wishlist',
      'Binders',
      'Sets',
      'Browse',
      'Scan',
      'Rip',
      'Friends',
      'Settings'
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Sets' }))
    expect(screen.getByRole('heading', { name: 'Sets' })).toBeInTheDocument()
  })
})

const entry = (id: number, name: string, language: 'en' | 'ja' = 'en'): EntryView => ({
  id,
  quantity: 2,
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  card: {
    id: 100 + id,
    name,
    type: 'Normal Monster',
    frameType: 'normal',
    race: 'Spellcaster',
    attribute: 'DARK',
    level: 7,
    linkval: null,
    atk: 2500,
    def: 2100,
    archetype: null,
    desc: '',
    tcgplayerPrice: 1
  },
  printing: {
    id,
    cardId: 100 + id,
    setName: 'Legend of Blue Eyes',
    setCode: `LOB-EN00${id}`,
    setRarity: 'Ultra Rare',
    setRarityCode: '(UR)',
    language,
    setPrice: 10,
    missingFromApi: false
  },
  imageId: 100 + id,
  printingScan: true,
  unitPrice: 10,
  priceApproximate: false,
  priceSource: 'ygoprodeck',
  priceCheckedAt: null,
  priceListingCount: null,
  noPriceReason: null,
  totalValue: 20
})

describe('dashboard most valuable', () => {
  // The Collection page filters to English by default; the dashboard ranks every language.
  it('opens the clicked card in the Collection page, even outside the language filter', async () => {
    const dm = entry(1, 'Dark Magician')
    const bew = entry(2, 'Blue-Eyes White Dragon', 'ja')
    const entries = [dm, bew]
    await renderApp(
      mockApi({
        stats: {
          get: async () => ({
            totalCards: 4,
            uniqueCards: 2,
            totalValue: 40,
            approximateCount: 0,
            byRarity: [],
            byFrameType: [],
            topEntries: [bew, dm],
            topSingles: [bew, dm],
            recentEntries: [],
            valueHistory: [],
            pricesUpdatedAt: null
          })
        },
        collection: {
          list: async (f: { language?: string }) =>
            entries.filter((e) => !f.language || e.printing.language === f.language),
          forCard: async (cardId: number) => entries.filter((e) => e.card.id === cardId)
        },
        cards: {
          get: async (id: number) => ({
            card: entries.find((e) => e.card.id === id)!.card,
            printings: [],
            images: []
          })
        }
      })
    )
    const most = (await screen.findByRole('heading', { name: 'Most valuable' })).closest('section')!
    await userEvent.click(within(most).getByRole('button', { name: /Blue-Eyes White Dragon/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Blue-Eyes White Dragon')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Collection', hidden: true })).toBeInTheDocument()
  })
})

describe('AppShell rip nav', () => {
  it('opens the Rip page from the nav', async () => {
    await renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Rip' }))
    expect(await screen.findByRole('heading', { name: 'Rip' })).toBeInTheDocument()
  })

  it('has no Rip item on the web', async () => {
    await renderApp(mockApi({ window: { platform: 'web' } }))
    expect(screen.queryByRole('button', { name: 'Rip' })).not.toBeInTheDocument()
  })
})

describe('data changed', () => {
  it('refetches the sets queries when main reports changed data', async () => {
    let fire: () => void = () => {}
    const api = mockApi({ app: { onDataChanged: vi.fn((cb) => ((fire = cb), () => {})) } })
    await renderApp(api)
    await userEvent.click(screen.getByRole('button', { name: 'Sets' }))
    await waitFor(() => expect(api.sets.list).toHaveBeenCalled())
    const before = vi.mocked(api.sets.list).mock.calls.length
    act(() => fire())
    await waitFor(() => expect(vi.mocked(api.sets.list).mock.calls.length).toBeGreaterThan(before))
  })

  it('also invalidates card detail queries', async () => {
    let fire: () => void = () => {}
    const api = mockApi({ app: { onDataChanged: vi.fn((cb) => ((fire = cb), () => {})) } })
    const { client } = await renderApp(api)
    await waitFor(() => expect(api.app.onDataChanged).toHaveBeenCalled())
    const spy = vi.spyOn(client, 'invalidateQueries')
    act(() => fire())
    expect(spy).toHaveBeenCalledWith({ queryKey: ['card'] })
  })
})

describe('SyncBanner', () => {
  it('shows the first-run message and Retry runs a sync', async () => {
    const run = vi.fn(async () => status({ cardCount: 5 }))
    const api = mockApi({ sync: { status: async () => status({ cardCount: 0 }), run } })
    await renderApp(api)
    expect(await screen.findByText(/No card data yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(run).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText(/No card data yet/)).not.toBeInTheDocument())
  })

  it('shows why card data cannot update, with Retry, ahead of the offline message', async () => {
    const run = vi.fn(async () => status())
    const api = mockApi({
      sync: {
        status: async () =>
          status({ state: 'error', error: 'x', blocked: "Couldn't back up your collection" }),
        run
      }
    })
    await renderApp(api)
    expect(
      await screen.findByText(
        "Card data can't update right now: Couldn't back up your collection. Duel Binder will try again."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('shows downloading, not the blocked warning, while a download runs', async () => {
    const api = mockApi({
      sync: { status: async () => status({ state: 'downloading', blocked: 'Some reason' }) }
    })
    await renderApp(api)
    expect(await screen.findByText('Downloading card database…')).toBeInTheDocument()
    expect(screen.queryByText(/can't update right now/)).not.toBeInTheDocument()
  })

  it('shows the blocked warning, not the no-data message, when there are no cards', async () => {
    const api = mockApi({
      sync: { status: async () => status({ cardCount: 0, blocked: 'Some reason' }) }
    })
    await renderApp(api)
    expect(
      await screen.findByText("Card data can't update right now: Some reason. Duel Binder will try again.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/No card data yet/)).not.toBeInTheDocument()
  })

  it('says card data could not update, not offline, when a sync failed but cards exist', async () => {
    const api = mockApi({
      sync: { status: async () => status({ state: 'error', error: 'HTTP 500', cardCount: 5, lastSyncAt: new Date().toISOString() }) }
    })
    await renderApp(api)
    expect(
      await screen.findByText("Card data couldn't update — using saved card data")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('says offline with saved data when the account is offline', async () => {
    const api = mockApi({
      sync: { status: async () => status({ cardCount: 5, lastSyncAt: new Date().toISOString() }) }
    })
    const signedIn = await api.account.status()
    api.account.status = vi.fn(async () => ({ ...signedIn, state: 'offline' as const }))
    await renderApp(api)
    expect(
      await screen.findByText('Offline — using saved card data (prices updated just now)')
    ).toBeInTheDocument()
  })

  it('says a census failure tries again after a restart, with no Retry', async () => {
    const api = mockApi({
      sync: {
        status: async () =>
          status({ blocked: "Your collection didn't match after updating card data", blockedRetry: 'next-launch' })
      }
    })
    await renderApp(api)
    expect(
      await screen.findByText(
        "Card data can't update right now: Your collection didn't match after updating card data. Duel Binder will try again after a restart."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('asks to connect when the first sync failed with no cards', async () => {
    const api = mockApi({ sync: { status: async () => status({ state: 'error', error: 'HTTP 500', cardCount: 0 }) } })
    await renderApp(api)
    expect(await screen.findByText(/Connect to the internet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows progress while downloading', async () => {
    const api = mockApi({ sync: { status: async () => status({ state: 'downloading', cardCount: 0 }) } })
    await renderApp(api)
    expect(await screen.findByText('Downloading card database…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})

describe('CardArt', () => {
  it('loads from ygo-img and swaps to a placeholder on error', () => {
    const { container } = renderWithProviders(<CardArt imageId={123} size="small" alt="Dark Magician" />)
    const img = screen.getByAltText('Dark Magician')
    expect(img).toHaveAttribute('src', 'ygo-img://small/123')
    expect(img).toHaveAttribute('loading', 'lazy')
    fireEvent.error(img)
    expect(screen.queryByAltText('Dark Magician')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="card-art-placeholder"]')).not.toBeNull()
  })
})
