import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from '@/features/settings/SettingsPage'
import type { AccountStatus } from '@shared/types'
import { createMockApi, renderWithProviders } from './mockApi'

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }
const base: AccountStatus = {
  state: 'signed-out',
  user: null,
  localOwner: null,
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0
}
const signedIn = (over: Partial<AccountStatus> = {}): AccountStatus => ({
  ...base,
  state: 'idle',
  user: seto,
  localOwner: 'Seto',
  ...over
})

const make = (status: AccountStatus) =>
  createMockApi({
    window: { platform: 'linux' },
    account: { status: vi.fn(async () => status), syncNow: vi.fn(async () => status) }
  })

afterEach(() => {
  window.api = undefined as never
})

describe('desktop account section', () => {
  it('signed out shows Sign in with Discord', async () => {
    const user = userEvent.setup()
    const api = make(base)
    renderWithProviders(<SettingsPage />, { api })
    expect(
      await screen.findByText(
        "Sign in with Discord to keep this computer's collection in step with the web app and your other computers."
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in with Discord' }))
    expect(api.account.signIn).toHaveBeenCalledTimes(1)
  })

  it('signed out after an account names whose cards are shown', async () => {
    renderWithProviders(<SettingsPage />, { api: make({ ...base, localOwner: 'Seto', error: 'Sign-in timed out' }) })
    expect(
      await screen.findByText("Showing Seto's cards. Changes are kept and sync when Seto signs in again.")
    ).toBeInTheDocument()
    expect(screen.getByText('Sign-in timed out')).toBeInTheDocument()
  })

  it('signed in shows identity, last synced and Sync now', async () => {
    const user = userEvent.setup()
    const api = make(signedIn({ lastSyncedAt: new Date(Date.now() - 3 * 3600_000).toISOString() }))
    renderWithProviders(<SettingsPage />, { api })
    expect(await screen.findByText('Signed in as Seto')).toBeInTheDocument()
    expect(screen.getByText('Signing out keeps your cards on this computer.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(api.account.syncNow).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(api.account.signOut).toHaveBeenCalledTimes(1)
  })

  it('shows never, offline and error states', async () => {
    const { unmount } = renderWithProviders(<SettingsPage />, { api: make(signedIn({ state: 'offline' })) })
    expect(await screen.findByText("Offline. Changes will sync when you're back online.")).toBeInTheDocument()
    unmount()
    renderWithProviders(<SettingsPage />, { api: make(signedIn({ state: 'error', error: 'boom' })) })
    expect(await screen.findByText('Sync failed: boom')).toBeInTheDocument()
  })

  it('disables Sync now while syncing', async () => {
    renderWithProviders(<SettingsPage />, { api: make(signedIn({ state: 'syncing' })) })
    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeDisabled()
  })

  it('signing in shows a Cancel that signs out', async () => {
    const user = userEvent.setup()
    const api = make({ ...base, state: 'signing-in' })
    renderWithProviders(<SettingsPage />, { api })
    expect(await screen.findByText('Finish signing in in your browser…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.account.signOut).toHaveBeenCalledTimes(1)
  })

  it('waiting entries are explained', async () => {
    renderWithProviders(<SettingsPage />, { api: make(signedIn({ pendingCount: 4 })) })
    expect(
      await screen.findByText(
        '4 cards from your account are waiting for newer card data. Refresh card data to bring them in.'
      )
    ).toBeInTheDocument()
  })

  it('signed in hides the custom eBay address field', async () => {
    const { unmount } = renderWithProviders(<SettingsPage />, { api: make(signedIn()) })
    expect(await screen.findByText("While you're signed in, prices come from your Duel Binder account.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Price service address')).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<SettingsPage />, { api: make(base) })
    expect(await screen.findByLabelText('Price service address')).toBeInTheDocument()
    expect(screen.queryByText(/prices come from your Duel Binder account/)).not.toBeInTheDocument()
  })

  it('status pushed from main updates the section', async () => {
    let push: (s: AccountStatus) => void = () => {}
    const api = createMockApi({
      window: { platform: 'linux' },
      account: {
        status: vi.fn(async () => base),
        onChange: vi.fn((cb: (s: AccountStatus) => void) => {
          push = cb
          return () => {}
        })
      }
    })
    renderWithProviders(<SettingsPage />, { api })
    await screen.findByRole('button', { name: 'Sign in with Discord' })
    await waitFor(() => expect(api.account.onChange).toHaveBeenCalled())
    act(() => push(signedIn()))
    expect(await screen.findByText('Signed in as Seto')).toBeInTheDocument()
  })
})
