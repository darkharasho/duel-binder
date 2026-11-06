import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { adminTabUrl } from '@shared/ipc'
import type { AccountStatus } from '@shared/types'
import { createMockApi, renderWithProviders } from './mockApi'

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }
const status = (admin: boolean): AccountStatus => ({
  state: 'idle',
  user: admin ? { ...seto, admin: true } : seto,
  localOwner: 'Seto',
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0,
  signInRequired: false
})

afterEach(() => {
  window.api = undefined as never
})

describe('desktop Admin section', () => {
  it("opens the dashboard at the tab picked, for the owner's account", async () => {
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(true)) }
    })
    renderWithProviders(<App />, { api })
    const admin = await screen.findByRole('group', { name: 'Admin' })
    await userEvent.click(within(admin).getByRole('button', { name: 'Runs' }))
    expect(api.account.openAdmin).toHaveBeenCalledExactlyOnceWith('runs')
  })

  it('is not there for anyone else', async () => {
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(false)) }
    })
    renderWithProviders(<App />, { api })
    await waitFor(() => expect(api.account.status).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'Dashboard' })
    expect(screen.queryByRole('group', { name: 'Admin' })).not.toBeInTheDocument()
  })
})

describe('adminTabUrl', () => {
  it('puts a known tab on the link as its #fragment', () => {
    expect(adminTabUrl('https://app.duelbinder.com/admin/open?code=x', 'runs')).toBe(
      'https://app.duelbinder.com/admin/open?code=x#runs'
    )
  })

  it('leaves the link alone for anything else', () => {
    expect(adminTabUrl('/admin', 'nope')).toBe('/admin')
    expect(adminTabUrl('/admin', '../x')).toBe('/admin')
    expect(adminTabUrl('/admin', undefined)).toBe('/admin')
  })
})
