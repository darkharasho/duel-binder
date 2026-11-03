import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LAST_SIGN_IN } from '@shared/account'
import type { Api } from '@shared/ipc'
import { EMAIL_COPY } from '@shared/emailAuth'
import type { Me } from '@shared/cloud'
import type { AccountStatus } from '@shared/types'
import { AccountNotices } from '@/features/account/AccountNotices'
import { SignInMethods } from '@/features/settings/SignInMethods'
import { createMockApi, renderWithProviders } from './mockApi'

const build = vi.hoisted(() => ({ platform: 'web' as 'web' | 'ios' | 'android' }))
vi.mock('@/lib/portal', async (orig) => ({
  ...(await orig<typeof import('@/lib/portal')>()),
  get APP_PLATFORM() {
    return build.platform
  }
}))

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
  build.platform = 'web'
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
    renderWithProviders(
      <>
        <AccountNotices />
        <SignInMethods />
      </>,
      { api }
    )
    // The user has loaded and rendered, so a prompt would be showing by now.
    expect(await screen.findByText('@ann')).toBeInTheDocument()
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
    await u.click(within(dialog).getByRole('button', { name: 'Remove' }))
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

describe('email sign-in settings', () => {
  const emailMethod = {
    provider: 'email' as const,
    email: 'ann@example.com',
    addedAt: '2026-10-23T12:00:00.000Z'
  }
  const discord = { provider: 'discord' as const, addedAt: '2026-10-23T12:00:00.000Z' }
  const makeEmail = (
    methods: unknown[],
    over: Partial<Me> = {},
    account: Record<string, unknown> = {}
  ): Api =>
    make(me({ usernameChosen: true, emailSignIn: true, ...over }), [], {
      signIns: vi.fn(async () => methods),
      ...account
    })

  it('shows the address and Change password for an email sign-in', async () => {
    renderWithProviders(<SignInMethods />, { api: makeEmail([discord, emailMethod]) })
    expect(await screen.findByText('Email · ann@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change email' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add email' })).toBeNull()
  })

  it('Add email hidden without emailSignIn', async () => {
    renderWithProviders(<SignInMethods />, {
      api: makeEmail([discord], { emailSignIn: undefined })
    })
    await screen.findByText('Discord')
    expect(screen.queryByRole('button', { name: 'Add email' })).toBeNull()
  })

  it('add email → code → listed', async () => {
    const u = userEvent.setup()
    let listed: unknown[] = [discord]
    const api = makeEmail(
      [],
      {},
      {
        signIns: vi.fn(async () => listed),
        addEmail: vi.fn(async () => ({ status: 'code', ticket: 'tk' })),
        confirmEmail: vi.fn(async () => {
          listed = [discord, emailMethod]
          return { status: 'linked' }
        })
      }
    )
    renderWithProviders(<SignInMethods />, { api })
    await u.click(await screen.findByRole('button', { name: 'Add email' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByPlaceholderText('Email')).toBeInTheDocument()
    expect(
      within(dialog).getByPlaceholderText('Password (at least 8 characters)')
    ).toBeInTheDocument()
    await u.type(within(dialog).getByRole('textbox', { name: 'Email' }), ' Ann@Example.com ')
    await u.type(within(dialog).getByLabelText('Password'), 'hunter22!')
    await u.click(within(dialog).getByRole('button', { name: 'Send code' }))
    await waitFor(() =>
      expect(api.account.addEmail).toHaveBeenCalledWith('ann@example.com', 'hunter22!')
    )
    const confirm = await within(dialog).findByRole('button', { name: 'Confirm' })
    expect(confirm).toBeDisabled()
    await u.type(within(dialog).getAllByRole('textbox')[0], '123456')
    await u.click(confirm)
    await waitFor(() => expect(api.account.confirmEmail).toHaveBeenCalledWith('tk', '123456'))
    await u.click(await screen.findByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Email · ann@example.com')).toBeInTheDocument()
  })

  it('a merge result on desktop shows the phone copy', async () => {
    const u = userEvent.setup()
    const api = makeEmail(
      [discord],
      {},
      {
        addEmail: vi.fn(async () => ({ status: 'merge', ticket: 'tk', preview: {} }))
      }
    )
    renderWithProviders(<SignInMethods />, { api })
    await u.click(await screen.findByRole('button', { name: 'Add email' }))
    const dialog = await screen.findByRole('dialog')
    await u.type(within(dialog).getByRole('textbox', { name: 'Email' }), 'ann@example.com')
    await u.type(within(dialog).getByLabelText('Password'), 'hunter22!')
    await u.click(within(dialog).getByRole('button', { name: 'Send code' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(EMAIL_COPY.mergeOnPhone)
  })

  it("change password shows the portal's error", async () => {
    const u = userEvent.setup()
    const api = makeEmail(
      [discord, emailMethod],
      {},
      {
        changePassword: vi.fn(async () => {
          throw new Error("That password doesn't match.")
        })
      }
    )
    renderWithProviders(<SignInMethods />, { api })
    await u.click(await screen.findByRole('button', { name: 'Change password' }))
    const dialog = await screen.findByRole('dialog')
    await u.type(within(dialog).getByLabelText('Current password'), 'wrongpass')
    await u.type(within(dialog).getByLabelText('New password'), 'newpass123')
    await u.click(within(dialog).getByRole('button', { name: 'Change password' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "That password doesn't match."
    )
    expect(api.account.changePassword).toHaveBeenCalledWith('wrongpass', 'newpass123')
  })
})

describe('link hint', () => {
  it('shows the right copy and dismisses', async () => {
    const u = userEvent.setup()
    let emit: (s: AccountStatus) => void = () => {}
    const cleared = me({ usernameChosen: true, linkHint: null })
    const api = make(me({ usernameChosen: true, linkHint: 'discord' }), ['discord'], {
      onChange: vi.fn((cb: (s: AccountStatus) => void) => {
        emit = cb
        return () => {}
      }),
      dismissLinkHint: vi.fn(async () => {
        // The desktop's account.onChange brings the stored account back changed.
        act(() => emit(status(cleared)))
        return cleared
      })
    })
    renderWithProviders(<AccountNotices />, { api })
    expect(
      await screen.findByText('Already use Duel Binder with Discord? Link it in Settings.')
    ).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(api.account.dismissLinkHint).toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.queryByText('Already use Duel Binder with Discord? Link it in Settings.')
      ).not.toBeInTheDocument()
    )
  })

  it('apple on the iPhone app points at Settings', async () => {
    build.platform = 'ios'
    renderWithProviders(<AccountNotices />, {
      api: make(me({ usernameChosen: true, linkHint: 'apple' }))
    })
    expect(
      await screen.findByText('Already use Duel Binder with Apple? Link it in Settings.')
    ).toBeInTheDocument()
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
