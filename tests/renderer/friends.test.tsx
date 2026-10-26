import { act, screen, waitFor } from '@testing-library/react'
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
  pendingCount: 0,
  unsyncedCount: 0
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
  localStorage.clear()
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
    shell(make({ friends: [], incoming: [], blocked: [] }))
    const names = screen.getAllByRole('button').map((b) => b.textContent)
    const i = names.indexOf('Friends')
    expect(names[i - 1]).toBe('Browse')
    expect(names[i + 1]).toBe('Settings')
  })

  it('is hidden on desktop when signed out', async () => {
    const api = make(
      { friends: [], incoming: [], blocked: [] },
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
      { friends: [], incoming: [], blocked: [] },
      {
        window: { platform: 'linux' },
        account: { status: vi.fn(async () => signedIn) }
      }
    )
    shell(api)
    expect(await screen.findByRole('button', { name: 'Friends' })).toBeInTheDocument()
  })

  it('shows at once on desktop when the last status was signed in, before fetching', async () => {
    localStorage.setItem('friends.signedIn', '1')
    const api = make(
      { friends: [], incoming: [], blocked: [] },
      {
        window: { platform: 'linux' },
        account: { status: vi.fn(() => new Promise<AccountStatus>(() => {})) }
      }
    )
    shell(api)
    expect(screen.getByRole('button', { name: 'Friends' })).toBeInTheDocument()
    await waitFor(() => expect(api.account.status).toHaveBeenCalled())
    expect(api.friends.overview).not.toHaveBeenCalled()
  })

  it('remembers a signed-out status for the next start', async () => {
    const api = make(
      { friends: [], incoming: [], blocked: [] },
      { window: { platform: 'linux' }, account: { status: vi.fn(async () => signedOut) } }
    )
    shell(api)
    await waitFor(() => expect(localStorage.getItem('friends.signedIn')).toBe('0'))
  })

  it('badges incoming requests', async () => {
    shell(make({ friends: [], incoming: [alice(3), alice(4)], blocked: [] }))
    const btn = await screen.findByRole('button', { name: 'Friends, 2 requests' })
    expect(btn).toHaveTextContent('2')
  })

  it('has no number without requests', async () => {
    const api = make({ friends: [], incoming: [], blocked: [] })
    shell(api)
    await waitFor(() => expect(api.friends.overview).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Friends' })).not.toHaveTextContent(/\d/)
  })
})

describe('friends page', () => {
  it('sends a request', async () => {
    const user = userEvent.setup()
    const api = make({ friends: [], incoming: [], blocked: [] })
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
      { friends: [], incoming: [], blocked: [] },
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
      { friends: [], incoming: [], blocked: [] },
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
      incoming: [alice(3), { ...alice(4), displayName: 'Carl', username: 'carl' }],
      blocked: []
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
      { friends: [], incoming: [alice(3)], blocked: [] },
      {
        friends: {
          accept,
          overview: vi.fn(async () => ({ friends: [], incoming: [alice(3)], blocked: [] }))
        }
      }
    )
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    await user.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE_MESSAGE)
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('lists friends and unfriends after confirming', async () => {
    const user = userEvent.setup()
    const api = make({ friends: [bob], incoming: [], blocked: [] })
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

  it('blocks a friend after confirming', async () => {
    const user = userEvent.setup()
    const api = make({ friends: [bob], incoming: [], blocked: [] })
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    await user.click(await screen.findByRole('button', { name: 'Block' }))
    expect(screen.getByText('Block Bob?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.friends.block).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Block' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(api.friends.block).toHaveBeenCalledWith(2)
    expect(api.friends.remove).not.toHaveBeenCalled()
    await waitFor(() => expect(api.friends.overview).toHaveBeenCalledTimes(2))
  })

  it('blocks someone from their request', async () => {
    const user = userEvent.setup()
    const api = make({ friends: [], incoming: [alice(3)], blocked: [] })
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    await user.click(await screen.findByRole('button', { name: 'Block' }))
    expect(screen.getByText('Block Alice?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(api.friends.block).toHaveBeenCalledWith(3)
    expect(api.friends.ignore).not.toHaveBeenCalled()
  })

  it('lists blocked people with Unblock', async () => {
    const user = userEvent.setup()
    const carl = { id: 5, username: 'carl', displayName: 'Carl', avatarUrl: null }
    const api = make({ friends: [], incoming: [], blocked: [carl] })
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    const blocked = await screen.findByRole('region', { name: 'Blocked' })
    expect(blocked).toHaveTextContent('Carl')
    await user.click(screen.getByRole('button', { name: 'Unblock' }))
    expect(api.friends.unblock).toHaveBeenCalledWith(5)
  })

  it('says "1 card" for a single card', async () => {
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, {
      api: make({ friends: [{ ...bob, cardCount: 1 }], incoming: [], blocked: [] })
    })
    expect(await screen.findByText('1 card · Updated 2 days ago')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, {
      api: make({ friends: [], incoming: [], blocked: [] })
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
      .mockResolvedValue({ friends: [], incoming: [], blocked: [] })
    const api = make({ friends: [], incoming: [], blocked: [] }, { friends: { overview } })
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByText('No friends yet. Add one by their Discord username.')
    ).toBeInTheDocument()
  })

  it('shows the signed-out message on desktop', async () => {
    const api = make(
      { friends: [], incoming: [], blocked: [] },
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

describe('friends cache across accounts', () => {
  it('drops the cached friends when the signed-in user changes', async () => {
    let emit: (s: AccountStatus) => void = () => {}
    const api = make(
      { friends: [bob], incoming: [], blocked: [] },
      {
        window: { platform: 'linux' },
        account: {
          status: vi.fn(async () => signedIn),
          onChange: vi.fn((cb: (s: AccountStatus) => void) => {
            emit = cb
            return () => {}
          })
        }
      }
    )
    const { client } = renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    expect(client.getQueryData(['friends'])).toBeDefined()

    // The same user pushing a status update keeps the cache.
    act(() => emit({ ...signedIn, state: 'syncing' }))
    expect(client.getQueryData(['friends'])).toBeDefined()

    act(() => emit({ ...signedIn, user: { ...seto, id: 99, username: 'other' } }))
    await waitFor(() => expect(client.getQueryData(['friends'])).toBeUndefined())
  })

  it('fetches the overview once at startup', async () => {
    const api = make(
      { friends: [bob], incoming: [], blocked: [] },
      { window: { platform: 'linux' }, account: { status: vi.fn(async () => signedIn) } }
    )
    renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(api.friends.overview).toHaveBeenCalledTimes(1)
  })

  it('drops the cached friends on sign-out', async () => {
    let emit: (s: AccountStatus) => void = () => {}
    const api = make(
      { friends: [bob], incoming: [], blocked: [] },
      {
        window: { platform: 'linux' },
        account: {
          status: vi.fn(async () => signedIn),
          onChange: vi.fn((cb: (s: AccountStatus) => void) => {
            emit = cb
            return () => {}
          })
        }
      }
    )
    const { client } = renderWithProviders(<FriendsPage onBackToMine={() => {}} />, { api })
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    act(() => emit(signedOut))
    await waitFor(() => expect(client.getQueryData(['friends'])).toBeUndefined())
  })
})
