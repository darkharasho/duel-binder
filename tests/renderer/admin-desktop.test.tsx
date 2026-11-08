import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { adminTabUrl } from '@shared/ipc'
import type { AdminStats } from '@shared/admin'
import type { Api } from '@shared/ipc'
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

const STATS: AdminStats = {
  at: '2026-11-08T10:00:00.000Z',
  users: { total: 42, discord: 30, apple: 5, email: 9, new7d: 3, new30d: 8 },
  active: { day: 7, week: 20, month: 33 },
  sessions: { desktop: 12, web: 4 },
  collections: { collectors: 10, entries: 900, cards: 1234, largest: [] },
  friends: { accepted: 2, pending: 1, blocks: 0 },
  scan: { contributions: 5, contributions7d: 1 },
  priceRequests: { today: 3, last7d: 9 },
  sweep: { callsToday: 100, sweptLast7d: 4, prefixes: 50 },
  usage: { since: '2026-10-09', totals: [], opensByDay: [{ day: '2026-11-07', count: 5 }] },
  storage: { databaseBytes: 50_000_000, rows: { cards: 10 } }
}

function adminApi(): NonNullable<Api['admin']> {
  return {
    stats: vi.fn(async () => STATS),
    errors: vi.fn(async () => []),
    runs: vi.fn(async () => []),
    jobs: vi.fn(async () => []),
    merges: vi.fn(async () => []),
    undoMerge: vi.fn(async () => []),
    testers: vi.fn(async () => [
      { id: 4, game: 'op' as const, discordUsername: null, userId: 2, username: 'kaiba' }
    ]),
    addTester: vi.fn(async () => {}),
    removeTester: vi.fn(async () => {}),
    admins: vi.fn(async () => ({ admins: [], you: 1 })),
    addAdmin: vi.fn(async () => {}),
    removeAdmin: vi.fn(async () => {}),
    photos: vi.fn(async () => ({ games: [], testers: [], holders: [] }))
  }
}

describe('desktop admin pages', () => {
  it('shows the admin tabs in the app and reads the stats once for every stats tab', async () => {
    const admin = adminApi()
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(true)) }
    })
    api.admin = admin
    renderWithProviders(<App />, { api })
    const group = await screen.findByRole('group', { name: 'Admin' })
    expect(within(group).getAllByRole('button')).toHaveLength(1)
    await userEvent.click(within(group).getByRole('button', { name: 'Admin' }))
    expect(await screen.findByText('active this month')).toBeInTheDocument()
    expect(screen.getByText('33')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Users' }))
    expect(await screen.findByText('Largest collections')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Storage' }))
    expect(await screen.findByText(/of the 5 GB free-plan limit/)).toBeInTheDocument()
    expect(admin.stats).toHaveBeenCalledTimes(1)
    expect(api.account.openAdmin).not.toHaveBeenCalled()
    expect(admin.errors).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(admin.stats).toHaveBeenCalledTimes(2))
  })

  it('adds and removes testers', async () => {
    const admin = adminApi()
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(true)) }
    })
    api.admin = admin
    renderWithProviders(<App />, { api })
    const group = await screen.findByRole('group', { name: 'Admin' })
    await userEvent.click(within(group).getByRole('button', { name: 'Admin' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Testers' }))
    expect(await screen.findByText('@kaiba')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Username' }), 'yugi')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(admin.addTester).toHaveBeenCalledExactlyOnceWith('op', 'username', 'yugi')
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(admin.removeTester).toHaveBeenCalledExactlyOnceWith(4))
  })

  it("says so when the portal doesn't take the account as an admin", async () => {
    const admin = adminApi()
    admin.merges = vi.fn(async () => {
      throw new Error("Error invoking remote method 'admin:merges': Error: Not found")
    })
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(true)) }
    })
    api.admin = admin
    renderWithProviders(<App />, { api })
    const group = await screen.findByRole('group', { name: 'Admin' })
    await userEvent.click(within(group).getByRole('button', { name: 'Admin' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Merges' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not an admin.')
  })
})

describe('desktop Admin section', () => {
  it('opens the portal dashboard where there are no admin pages', async () => {
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(true)) }
    })
    renderWithProviders(<App />, { api })
    const admin = await screen.findByRole('group', { name: 'Admin' })
    await userEvent.click(within(admin).getByRole('button', { name: 'Admin' }))
    expect(api.account.openAdmin).toHaveBeenCalledExactlyOnceWith()
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
