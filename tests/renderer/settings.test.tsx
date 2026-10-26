import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const synced = {
  state: 'idle',
  lastSyncAt: '2026-10-20T12:00:00.000Z',
  dbVersion: '142.17',
  cardCount: 13000,
  error: null,
  blocked: null
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
