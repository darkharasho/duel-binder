import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { SettingsPage } from '@/features/settings/SettingsPage'
import type { UnsyncedEntry } from '@shared/types'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const synced = {
  state: 'idle',
  lastSyncAt: '2026-10-20T12:00:00.000Z',
  dbVersion: '142.17',
  cardCount: 13000,
  error: null,
  blocked: null,
  blockedRetry: null
} as const

describe('SettingsPage', () => {
  it('refresh button calls sync.run and is disabled while syncing', async () => {
    const user = userEvent.setup()
    const api = createMockApi({ sync: { status: vi.fn(async () => ({ ...synced })) } })
    const { unmount } = renderWithProviders(<SettingsPage />, { api })
    const button = await screen.findByRole('button', { name: 'Refresh card data' })
    expect(button).toBeEnabled()
    expect(await screen.findByText('13,000')).toBeInTheDocument()
    expect(screen.getByText('142.17')).toBeInTheDocument()
    await user.click(button)
    expect(api.sync.run).toHaveBeenCalledTimes(1)
    unmount()

    const busy = createMockApi({ sync: { status: vi.fn(async () => ({ ...synced, state: 'downloading' as const })) } })
    renderWithProviders(<SettingsPage />, { api: busy })
    await waitFor(() => expect(screen.getByRole('button', { name: /Refresh card data|Syncing/ })).toBeDisabled())
  })

  it('credits Yugipedia for non-English set lists', async () => {
    renderWithProviders(<SettingsPage />, { api: createMockApi() })
    expect(
      await screen.findByText(/Non-English set lists from/)
    ).toHaveTextContent('Non-English set lists from Yugipedia (CC BY-SA 4.0).')
    expect(screen.getByRole('link', { name: 'Yugipedia' })).toHaveAttribute(
      'href',
      'https://yugipedia.com/'
    )
  })

  it('says prices come from the account', async () => {
    renderWithProviders(<SettingsPage />, { api: createMockApi() })
    expect(await screen.findByText('Prices come from your Duel Binder account.')).toBeInTheDocument()
    expect(screen.queryByText(/eBay/i)).not.toBeInTheDocument()
  })

  it('lists the cards that cannot sync when asked', async () => {
    const user = userEvent.setup()
    const issue = (
      uid: string,
      reason: string,
      language: 'fr' | 'zh-hans' | 'en' = 'en'
    ): UnsyncedEntry => ({
      uid,
      name: 'Dark Magician',
      setCode: 'LOB-005',
      setName: 'Legend of Blue Eyes',
      rarity: 'Ultra Rare',
      language,
      quantity: 2,
      reason
    })
    const unsynced = vi.fn(async () => [
      issue('u1', 'unknown-printing', 'zh-hans'),
      issue('u2', 'unknown-card', 'fr'),
      issue('u3', 'bad-field'),
      issue('u4', 'daily-limit'),
      issue('u5', 'something-new')
    ])
    const api = createMockApi({
      account: {
        status: vi.fn(async () => ({
          state: 'idle' as const,
          user: { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null },
          localOwner: 'Seto',
          lastSyncedAt: null,
          error: null,
          pendingCount: 0,
          unsyncedCount: 3,
          signInRequired: true
        })),
        unsynced
      }
    })
    renderWithProviders(<SettingsPage />, { api })
    expect(await screen.findByText("3 cards can't reach your account yet.")).toBeInTheDocument()
    expect(unsynced).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Show' }))
    const dialog = await screen.findByRole('dialog')
    for (const t of [
      'Dark Magician',
      'LOB-005 · Legend of Blue Eyes · Ultra Rare',
      "This printing isn't on the server yet",
      "This card isn't on the server",
      'The printing details were rejected',
      'Daily limit reached; Duel Binder will try again tomorrow',
      "Couldn't sync this card",
      '×2'
    ])
      expect(dialog).toHaveTextContent(t)
    // Language tags, not raw codes.
    expect(within(dialog).getByText('SC')).toBeInTheDocument()
    expect(within(dialog).getByText('FR')).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/ZH-HANS|unknown-printing|bad-field/i)
  })

  describe('unsynced dialog states', () => {
    const accountWith = (count: number, unsynced: () => Promise<never[]>): ReturnType<typeof createMockApi> =>
      createMockApi({
        account: {
          status: vi.fn(async () => ({
            state: 'idle' as const,
            user: { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null },
            localOwner: 'Seto',
            lastSyncedAt: null,
            error: null,
            pendingCount: 0,
            unsyncedCount: count,
            signInRequired: true
          })),
          unsynced
        }
      })

    it('says nothing to show for an empty list, and uses singular copy for one card', async () => {
      const user = userEvent.setup()
      renderWithProviders(<SettingsPage />, { api: accountWith(1, async () => []) })
      expect(await screen.findByText("1 card can't reach your account yet.")).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Show' }))
      expect(await screen.findByText('Nothing to show.')).toBeInTheDocument()
    })

    it('says it could not load the list when the request fails', async () => {
      const user = userEvent.setup()
      const api = accountWith(2, async () => {
        throw new Error('boom')
      })
      renderWithProviders(<SettingsPage />, { api })
      await user.click(await screen.findByRole('button', { name: 'Show' }))
      expect(await screen.findByText("Couldn't load the list")).toBeInTheDocument()
    })
  })

  it('shows the last sync error', async () => {
    const api = createMockApi({
      sync: { status: vi.fn(async () => ({ ...synced, state: 'error' as const, error: 'HTTP 500' })) }
    })
    renderWithProviders(<SettingsPage />, { api })
    expect(await screen.findByText(/HTTP 500/)).toBeInTheDocument()
  })

  it('backup shows saved path', async () => {
    const user = userEvent.setup()
    const api = createMockApi({ app: { backupDatabase: vi.fn(async () => '/tmp/duel-binder-2026-10-23.db') } })
    renderWithProviders(<SettingsPage />, { api })
    await user.click(await screen.findByRole('button', { name: /Back up collection/ }))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('/tmp/duel-binder-2026-10-23.db'))
    )
  })

  it('backup cancelled shows no toast', async () => {
    vi.mocked(toast.success).mockClear()
    const user = userEvent.setup()
    const api = createMockApi()
    renderWithProviders(<SettingsPage />, { api })
    await user.click(await screen.findByRole('button', { name: /Back up collection/ }))
    await waitFor(() => expect(api.app.backupDatabase).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('check for updates shows status', async () => {
    const user = userEvent.setup()
    const api = createMockApi({
      app: {
        version: vi.fn(async () => '1.0.0'),
        checkForUpdates: vi.fn(async () => ({ state: 'none' as const, mode: 'auto' as const, version: null, error: null }))
      }
    })
    renderWithProviders(<SettingsPage />, { api })
    expect(await screen.findByText('1.0.0')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText("You're up to date")).toBeInTheDocument()
  })

  it('shows image cache size and clears it', async () => {
    const user = userEvent.setup()
    const api = createMockApi({ images: { cacheSize: vi.fn(async () => 5 * 1024 * 1024) } })
    renderWithProviders(<SettingsPage />, { api })
    expect(await screen.findByText('5.0 MB')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear image cache' }))
    expect(api.images.clearCache).toHaveBeenCalled()
  })
})
