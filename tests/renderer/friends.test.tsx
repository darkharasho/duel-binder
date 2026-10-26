import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from '@/components/AppShell'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { FRIENDS_SIGNED_OUT, OFFLINE_MESSAGE } from '@shared/friends'
import type { AccountStatus, Friend, FriendRequest, FriendsOverview } from '@shared/types'
import { createMockApi, renderWithProviders, type DeepPartial } from './mockApi'
import type { Api } from '@shared/ipc'

const seto = { id: 1, username: 'seto', displayName: 'Seto', avatarUrl: null }
const signedOut: AccountStatus = {
  state: 'signed-out',
  user: null,
  localOwner: null,
  lastSyncedAt: null,
  error: null,
  pendingCount: 0
}
const signedIn: AccountStatus = { ...signedOut, state: 'idle', user: seto }

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString()
const bob: Friend = {
  id: 2,
  username: 'bob',
  displayName: 'Bob',
  avatarUrl: null,
  cardCount: 42,
  updatedAt: daysAgo(2)
}
const alice = (id = 3): FriendRequest => ({
  id,
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  sentAt: daysAgo(1)
})

const make = (overview: FriendsOverview, over: DeepPartial<Api> = {}): Api =>
  createMockApi({
    window: { platform: 'web' },
    friends: { overview: vi.fn(async () => overview) },
    ...over
  })

afterEach(() => {
  window.api = undefined as never
})

const shell = (api: Api): void => {
  renderWithProviders(
    <AppShell page="dashboard" onNavigate={() => {}} onAddCard={() => {}}>
      x
    </AppShell>,
    { api }
  )
}

describe('friends nav', () => {
  it('is shown between Browse and Settings on web', () => {
    shell(make({ friends: [], incoming: [] }))
    const names = screen.getAllByRole('button').map((b) => b.textContent)
    const i = names.indexOf('Friends')
    expect(names[i - 1]).toBe('Browse')
    expect(names[i + 1]).toBe('Settings')
  })

  it('is hidden on desktop when signed out', async () => {
    const api = make(
      { friends: [], incoming: [] },
      {
        window: { platform: 'linux' },
        account: { status: vi.fn(async () => signedOut) }
      }
    )
    shell(api)
    await waitFor(() => expect(api.account.status).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /^Friends/ })).not.toBeInTheDocument()
    expect(api.friends.overview).not.toHaveBeenCalled()
  })

  it('is shown on desktop when signed in', async () => {
    const api = make(
      { friends: [], incoming: [] },
      {
        window: { platform: 'linux' },
        account: { status: vi.fn(async () => signedIn) }
      }
    )
    shell(api)
    expect(await screen.findByRole('button', { name: 'Friends' })).toBeInTheDocument()
  })

  it('badges incoming requests', async () => {
    shell(make({ friends: [], incoming: [alice(3), alice(4)] }))
    const btn = await screen.findByRole('button', { name: 'Friends, 2 requests' })
    expect(btn).toHaveTextContent('2')
  })

  it('has no number without requests', async () => {
    const api = make({ friends: [], incoming: [] })
    shell(api)
    await waitFor(() => expect(api.friends.overview).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Friends' })).not.toHaveTextContent(/\d/)
  })
})

describe('friends page', () => {
  it('sends a request', async () => {
    const user = userEvent.setup()
    const api = make({ friends: [], incoming: [] })
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    const send = screen.getByRole('button', { name: 'Send request' })
    expect(send).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Discord username' }), 'bob')
    await user.click(send)
    expect(api.friends.request).toHaveBeenCalledWith('bob')
    expect(await screen.findByText('Request sent')).toBeInTheDocument()
  })

  it('reports an accepted request', async () => {
    const user = userEvent.setup()
    const api = make(
      { friends: [], incoming: [] },
      {
        friends: { request: vi.fn(async () => ({ status: 'accepted' as const, friend: bob })) }
      }
    )
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    await user.type(screen.getByRole('textbox', { name: 'Discord username' }), 'bob')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText("You're now friends with Bob")).toBeInTheDocument()
  })

  it('shows a request error inline', async () => {
    const user = userEvent.setup()
    const api = make(
      { friends: [], incoming: [] },
      {
        friends: {
          request: vi.fn(async () => {
            throw new Error('No Duel Binder user called "bob"')
          })
        }
      }
    )
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    await user.type(screen.getByRole('textbox', { name: 'Discord username' }), 'bob')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('No Duel Binder user called "bob"')).toBeInTheDocument()
  })

  it('accepts and ignores incoming requests, then refetches', async () => {
    const user = userEvent.setup()
    const api = make({
      friends: [],
      incoming: [alice(3), { ...alice(4), displayName: 'Carl', username: 'carl' }]
    })
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    await screen.findByText('Alice')
    expect(api.friends.overview).toHaveBeenCalledTimes(1)
    await user.click(screen.getAllByRole('button', { name: 'Accept' })[0])
    expect(api.friends.accept).toHaveBeenCalledWith(3)
    await waitFor(() => expect(api.friends.overview).toHaveBeenCalledTimes(2))
    await user.click(screen.getAllByRole('button', { name: 'Ignore' })[1])
    expect(api.friends.ignore).toHaveBeenCalledWith(4)
    await waitFor(() => expect(api.friends.overview).toHaveBeenCalledTimes(3))
  })

  it('shows a failed accept and clears it on the next action', async () => {
    const user = userEvent.setup()
    const accept = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(`Error invoking remote method 'friends:accept': Error: ${OFFLINE_MESSAGE}`)
      )
      .mockResolvedValue(undefined)
    const api = make(
      { friends: [], incoming: [alice(3)] },
      { friends: { accept, overview: vi.fn(async () => ({ friends: [], incoming: [alice(3)] })) } }
    )
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    await user.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE_MESSAGE)
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('lists friends and unfriends after confirming', async () => {
    const user = userEvent.setup()
    const api = make({ friends: [bob], incoming: [] })
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('@bob')).toBeInTheDocument()
    expect(screen.getByText('42 cards · Updated 2 days ago')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unfriend' }))
    expect(screen.getByText('Unfriend Bob?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.friends.remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Unfriend' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(api.friends.remove).toHaveBeenCalledWith(2)
  })

  it('shows the empty state', async () => {
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, {
      api: make({ friends: [], incoming: [] })
    })
    expect(
      await screen.findByText('No friends yet. Add one by their Discord username.')
    ).toBeInTheDocument()
  })

  it('shows offline with Retry', async () => {
    const user = userEvent.setup()
    const overview = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(`Error invoking remote method 'friends:overview': Error: ${OFFLINE_MESSAGE}`)
      )
      .mockResolvedValue({ friends: [], incoming: [] })
    const api = make({ friends: [], incoming: [] }, { friends: { overview } })
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByText('No friends yet. Add one by their Discord username.')
    ).toBeInTheDocument()
  })

  it('shows the signed-out message on desktop', async () => {
    const api = make(
      { friends: [], incoming: [] },
      {
        window: { platform: 'linux' },
        account: { status: vi.fn(async () => signedOut) }
      }
    )
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    expect(await screen.findByText(FRIENDS_SIGNED_OUT)).toBeInTheDocument()
    expect(api.friends.overview).not.toHaveBeenCalled()
  })
})
