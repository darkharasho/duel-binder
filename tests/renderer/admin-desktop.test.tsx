import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { adminTabUrl } from '@shared/ipc'
import type { AdminStats } from '@shared/admin'
import { projectMonthly, type AdminCosts } from '@shared/costs'
import type { Api } from '@shared/ipc'
import type { AccountStatus } from '@shared/types'
import { createMockApi, renderWithProviders } from './mockApi'
import { withGameAccess } from '../fixtures/ownerOnlyGame'

withGameAccess('mtg', 'testers')
withGameAccess('op', 'testers')

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

const PER_USER = { requests: 3000, rowsRead: 20e6, rowsWritten: 20_000, ms: 60_000 }
const SYSTEM = { requests: 500, rowsRead: 1e9, rowsWritten: 5e6, ms: 9000 }
const COSTS: AdminCosts = {
  at: '2026-11-16T10:00:00.000Z',
  since: '2026-10-18',
  days: 3,
  activeUsers: 5,
  people: PER_USER,
  system: SYSTEM,
  perUserMonth: PER_USER,
  systemMonth: SYSTEM,
  byUser: [{ userId: 1, username: 'seto', ...PER_USER }],
  byArea: [{ area: 'rpc sets:list', ...PER_USER }],
  byDay: [{ day: '2026-11-16', ...PER_USER }],
  projections: [5, 100, 500, 5000].map((n) =>
    projectMonthly({ perUser: PER_USER, system: SYSTEM, storageBytes: 1.2e9 }, n)
  ),
  storageBytes: 1.2e9
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
    photos: vi.fn(async () => ({ games: [], testers: [], holders: [] })),
    costs: vi.fn(async () => COSTS),
    supporters: vi.fn(async () => ({
      active: 2,
      monthly: 1,
      yearly: 1,
      monthlyCents: 508,
      list: [
        {
          userId: 3,
          username: 'yugi',
          displayName: 'Yugi',
          plan: 'year' as const,
          amountCents: 2500,
          status: 'active',
          since: '2026-11-16T12:00:00.000Z',
          until: '2027-11-16T00:00:00.000Z',
          cancelling: false,
          showOnSite: true
        },
        {
          userId: 2,
          username: 'kaiba',
          displayName: null,
          plan: 'month' as const,
          amountCents: 300,
          status: 'active',
          since: '2026-11-10T12:00:00.000Z',
          until: '2026-12-10T12:00:00.000Z',
          cancelling: true,
          showOnSite: false
        }
      ]
    })),
    beta: vi.fn(async () => ({
      requests: [
        {
          id: 1,
          email: 'sam@example.com',
          platform: 'android' as const,
          name: 'Sam',
          referredBy: 'Dub',
          status: 'pending' as const,
          createdAt: '2026-11-16T12:00:00.000Z',
          decidedAt: null
        },
        {
          id: 2,
          email: 'kai@example.com',
          platform: 'ios' as const,
          name: 'Kai',
          referredBy: '',
          status: 'added' as const,
          createdAt: '2026-11-15T12:00:00.000Z',
          decidedAt: '2026-11-15T13:00:00.000Z'
        }
      ],
      androidAdded: 3
    })),
    decideBeta: vi.fn(async () => ({ emailed: true })),
    deleteBeta: vi.fn(async () => {}),
    terms: vi.fn(async () => []),
    decideTerm: vi.fn(async () => {}),
    addTerm: vi.fn(async () => {}),
    captureSave: vi.fn(async () => '/data/rip-capture/x/k00001.jpg'),
    captureRemove: vi.fn(async () => undefined),
    captureNote: vi.fn(async () => undefined),
    captureOpenFolder: vi.fn(async () => undefined)
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

  it('shows what requests cost and the projected bill, for 30 or 7 days', async () => {
    const admin = adminApi()
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(true)) }
    })
    api.admin = admin
    renderWithProviders(<App />, { api })
    const group = await screen.findByRole('group', { name: 'Admin' })
    await userEvent.click(within(group).getByRole('button', { name: 'Admin' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Costs' }))
    expect(await screen.findByText('rows read per user a month')).toBeInTheDocument()
    expect(screen.getAllByText('20.0M').length).toBeGreaterThan(0)
    expect(screen.getByText('rpc sets:list')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '5 (now)' })).toBeInTheDocument()
    expect(admin.costs).toHaveBeenLastCalledWith(30)
    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => expect(admin.costs).toHaveBeenLastCalledWith(7))
  })

  it('shows supporters and monthly income before and after Stripe fees', async () => {
    const admin = adminApi()
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(true)) }
    })
    api.admin = admin
    renderWithProviders(<App />, { api })
    const group = await screen.findByRole('group', { name: 'Admin' })
    await userEvent.click(within(group).getByRole('button', { name: 'Admin' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Supporters' }))
    expect(await screen.findByText('$5.08')).toBeInTheDocument()
    expect(screen.getByText('a month, before Stripe fees')).toBeInTheDocument()
    // $25 a year: (2500 × 0.971 − 30) / 12 = 199.8; $3 a month: 300 × 0.971 − 30 = 261.3 → $4.61
    expect(screen.getByText('$4.61')).toBeInTheDocument()
    expect(screen.getByText('Yugi (yugi)')).toBeInTheDocument()
    expect(screen.getByText('active (cancelling)')).toBeInTheDocument()
    expect(admin.supporters).toHaveBeenCalledTimes(1)
  })

  it('adds a tester for Magic', async () => {
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
    await screen.findByText('@kaiba')
    await userEvent.click(screen.getByRole('combobox', { name: 'Game' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Magic' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Username' }), 'yugi')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(admin.addTester).toHaveBeenCalledExactlyOnceWith('mtg', 'username', 'yugi')
    )
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

  it('works through phone beta requests', async () => {
    const admin = adminApi()
    const api = createMockApi({
      window: { platform: 'linux' },
      account: { status: vi.fn(async () => status(true)) }
    })
    api.admin = admin
    renderWithProviders(<App />, { api })
    const group = await screen.findByRole('group', { name: 'Admin' })
    await userEvent.click(within(group).getByRole('button', { name: 'Admin' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Beta' }))
    expect(await screen.findByText('sam@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Android added: 3 of 12/)).toBeInTheDocument()
    expect(screen.getByText('Android (1 waiting)')).toBeInTheDocument()
    expect(screen.getByText('iPhone (0 waiting)')).toBeInTheDocument()
    expect(screen.getByText('kai@example.com')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Mark added' }))
    await waitFor(() => expect(admin.decideBeta).toHaveBeenCalledExactlyOnceWith(1, 'added'))

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    const decline = await screen.findByRole('dialog')
    await userEvent.click(within(decline).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(admin.decideBeta).toHaveBeenLastCalledWith(1, 'declined'))

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    const del = await screen.findByRole('dialog')
    await userEvent.click(within(del).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(admin.deleteBeta).toHaveBeenCalledExactlyOnceWith(2))
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
