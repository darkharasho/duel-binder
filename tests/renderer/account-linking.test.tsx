import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LAST_SIGN_IN } from '@shared/account'
import type { Api } from '@shared/ipc'
import type { Me } from '@shared/cloud'
import type { AccountStatus } from '@shared/types'
import { AccountNotices } from '@/features/account/AccountNotices'
import { SignInMethods } from '@/features/settings/SignInMethods'
import { createMockApi, renderWithProviders } from './mockApi'

const me = (over: Partial<Me> = {}): Me => ({
  id: 1,
  username: 'duelist-4821',
  displayName: null,
  avatarUrl: null,
  usernameChosen: false,
  ...over
})
const status = (user: Me): AccountStatus => ({
  state: 'idle',
  user,
  localOwner: 'x',
  lastSyncedAt: null,
  error: null,
  pendingCount: 0,
  unsyncedCount: 0,
  signInRequired: true
})
const make = (
  user: Me,
  methods: ('discord' | 'apple')[] = ['discord'],
  account: Record<string, unknown> = {}
): Api =>
  createMockApi({
    window: { platform: 'linux' },
    account: {
      status: vi.fn(async () => status(user)),
      signIns: vi.fn(async () =>
        methods.map((provider) => ({ provider, addedAt: '2026-10-23T12:00:00.000Z' }))
      ),
      ...account
    }
  })

afterEach(() => {
  window.api = undefined as never
})

describe('username prompt', () => {
  it('prompts an unchosen username once and saves it', async () => {
    const u = userEvent.setup()
    const api = make(me())
    renderWithProviders(<AccountNotices />, { api })
    const input = await screen.findByRole('textbox', { name: 'Username' })
    expect(input).toHaveValue('')
    await u.type(input, ' Ann_2 ')
    await u.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.account.setUsername).toHaveBeenCalledWith('Ann_2'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it("doesn't prompt a chosen username", async () => {
    const api = make(me({ username: 'ann', usernameChosen: true }))
    renderWithProviders(<AccountNotices />, { api })
    await waitFor(() => expect(api.account.status).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Not now closes the prompt until the next launch', async () => {
    const u = userEvent.setup()
    const api = make(me())
    const { rerender } = renderWithProviders(<AccountNotices />, { api })
    await u.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<AccountNotices />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the rule problem before saving', async () => {
    const u = userEvent.setup()
    renderWithProviders(<AccountNotices />, { api: make(me()) })
    await u.type(await screen.findByRole('textbox', { name: 'Username' }), 'a.b')
    expect(screen.getByText('Use letters, numbers, _ and - only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows a server error inline', async () => {
    const u = userEvent.setup()
    const api = make(me(), ['discord'], {
      setUsername: vi.fn(async () => {
        throw new Error('That username is taken')
      })
    })
    renderWithProviders(<AccountNotices />, { api })
    await u.type(await screen.findByRole('textbox', { name: 'Username' }), 'ann')
    await u.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('That username is taken')).toBeInTheDocument()
  })

  it('pre-fills a real name but not a generated one', async () => {
    const u = userEvent.setup()
    const api = make(me({ username: 'seto_k', usernameChosen: true }))
    renderWithProviders(<SignInMethods />, { api })
    await u.click(await screen.findByRole('button', { name: 'Change' }))
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('seto_k')
  })
})

describe('sign-in methods', () => {
  it('lists methods and blocks removing the last', async () => {
    renderWithProviders(<SignInMethods />, {
      api: make(me({ usernameChosen: true }), ['discord'])
    })
    expect(await screen.findByText('Discord')).toBeInTheDocument()
    const remove = screen.getByRole('button', { name: 'Remove' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('title', LAST_SIGN_IN)
  })

  it('removing asks first, then calls removeSignIn', async () => {
    const u = userEvent.setup()
    const api = make(me({ usernameChosen: true }), ['discord', 'apple'])
    renderWithProviders(<SignInMethods />, { api })
    await screen.findByText('Apple')
    await u.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    expect(api.account.removeSignIn).not.toHaveBeenCalled()
    expect(screen.getByText('Remove Apple sign-in?')).toBeInTheDocument()
    expect(
      screen.getByText("You won't be able to sign in with Apple until you link it again.")
    ).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    await u.click(
      dialog.querySelector('button.bg-destructive, button[data-variant="destructive"]')!
    )
    await waitFor(() => expect(api.account.removeSignIn).toHaveBeenCalledWith('apple'))
  })

  it('offers to link what is linkable', async () => {
    const u = userEvent.setup()
    const onLink = vi.fn()
    renderWithProviders(<SignInMethods linkable={['apple']} onLink={onLink} />, {
      api: make(me({ usernameChosen: true }))
    })
    await u.click(await screen.findByRole('button', { name: 'Link Apple' }))
    expect(onLink).toHaveBeenCalledWith('apple')
  })
})

describe('link hint', () => {
  it('shows the right copy and dismisses', async () => {
    const u = userEvent.setup()
    const api = make(me({ usernameChosen: true, linkHint: 'discord' }))
    renderWithProviders(<AccountNotices />, { api })
    expect(
      await screen.findByText('Already use Duel Binder with Discord? Link it in Settings.')
    ).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(api.account.dismissLinkHint).toHaveBeenCalled()
  })

  it('apple off the iPhone points at the iPhone', async () => {
    renderWithProviders(<AccountNotices />, {
      api: make(me({ usernameChosen: true, linkHint: 'apple' }))
    })
    expect(
      await screen.findByText(
        'Used Duel Binder with Apple on iPhone? Link it from Settings on your iPhone.'
      )
    ).toBeInTheDocument()
  })
})
