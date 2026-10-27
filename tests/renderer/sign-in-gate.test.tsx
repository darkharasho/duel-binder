import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import type { AccountStatus } from '@shared/types'
import type { Api } from '@shared/ipc'
import { createMockApi, renderWithProviders } from './mockApi'

const base: AccountStatus = {
  state: 'signed-out',
  user: null,
  localOwner: null,
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0,
  signInRequired: true
}
const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }

const make = (status: AccountStatus, platform = 'linux'): Api =>
  createMockApi({
    window: { platform },
    account: { status: vi.fn(async () => status) }
  })

afterEach(() => {
  window.api = undefined as never
})

describe('sign-in gate', () => {
  it('shows when signed out, with the app hidden', async () => {
    renderWithProviders(<App />, { api: make({ ...base, error: 'Sign-in timed out' }) })
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Duel Binder' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Duel Binder keeps your collection and card data in your account. Sign in with Discord to continue.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Sign-in timed out')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('shows neither gate nor app while the status loads', () => {
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(() => new Promise<AccountStatus>(() => {})) }
    })
    renderWithProviders(<App />, { api })
    expect(
      screen.queryByRole('heading', { name: 'Sign in to Duel Binder' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('the button signs in', async () => {
    const user = userEvent.setup()
    const api = make(base)
    renderWithProviders(<App />, { api })
    await user.click(await screen.findByRole('button', { name: 'Sign in with Discord' }))
    expect(api.account.signIn).toHaveBeenCalledTimes(1)
  })

  it('while signing in shows Cancel, which signs out', async () => {
    const user = userEvent.setup()
    const api = make({ ...base, state: 'signing-in' })
    renderWithProviders(<App />, { api })
    expect(await screen.findByText('Finish signing in in your browser…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.account.signOut).toHaveBeenCalledTimes(1)
  })

  it('offers sign-in when the status cannot be loaded', async () => {
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => Promise.reject(new Error('ipc down'))) }
    })
    renderWithProviders(<App />, { api })
    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeEnabled()
  })

  it('Cancel returns to a usable sign-in button', async () => {
    const user = userEvent.setup()
    const api = createMockApi({
      window: { platform: 'linux' },
      account: {
        status: vi.fn(async () => ({ ...base, state: 'signing-in' as const })),
        signOut: vi.fn(async () => ({ ...base }))
      }
    })
    renderWithProviders(<App />, { api })
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('offline with a user shows the app', async () => {
    renderWithProviders(<App />, { api: make({ ...base, state: 'offline', user: seto }) })
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Sign in to Duel Binder' })
    ).not.toBeInTheDocument()
  })

  it('signInRequired false shows the app', async () => {
    renderWithProviders(<App />, { api: make({ ...base, signInRequired: false }) })
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('the web never shows it', async () => {
    renderWithProviders(<App />, { api: make(base, 'web') })
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Sign in to Duel Binder' })
    ).not.toBeInTheDocument()
  })
})
