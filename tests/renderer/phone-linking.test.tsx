import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import type { MergePreview } from '@shared/account'
import type { Me } from '@shared/cloud'
import { App } from '../../src/phone/App'
import { linkableProviders, linkSignIn } from '../../src/phone/linking'
import { nativeSignIn, SignInCancelled } from '../../src/phone/nativeSignIn'
import type { PhoneStore } from '../../src/phone/data/store'
import { MergeDialog } from '@/features/account/MergeDialog'
import { fakeEngine, stubCamera, stubVideo } from './scanFakes'
import { SETO, fakeStore, installPhoneApi, json, setOnline, stubFetch } from './phoneFakes'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null
}))

const build = vi.hoisted(() => ({ platform: 'ios' as 'web' | 'ios' | 'android' }))
vi.mock('@/lib/portal', async (orig) => ({
  ...(await orig<typeof import('@/lib/portal')>()),
  get APP_PLATFORM() {
    return build.platform
  }
}))
vi.mock('../../src/phone/nativeSignIn', async (orig) => ({
  ...(await orig<typeof import('../../src/phone/nativeSignIn')>()),
  nativeSignIn: vi.fn()
}))

const at = '2026-10-23T12:00:00.000Z'
const PREVIEW: MergePreview = {
  mine: {
    username: 'seto',
    displayName: 'Seto',
    avatarUrl: null,
    cards: 10,
    binders: 2,
    wishes: 3
  },
  theirs: {
    username: 'kaiba',
    displayName: null,
    avatarUrl: null,
    cards: 7,
    binders: 1,
    wishes: 0
  },
  totals: { higher: 12, mine: 10, theirs: 7, sum: 17 }
}

describe('linkableProviders', () => {
  it('offers Apple only on iOS', () => {
    const d = [{ provider: 'discord' as const, addedAt: at }]
    const a = [{ provider: 'apple' as const, addedAt: at }]
    expect(linkableProviders('ios', d)).toEqual(['apple'])
    expect(linkableProviders('android', d)).toEqual([])
    expect(linkableProviders('ios', a)).toEqual(['discord'])
    expect(linkableProviders('android', a)).toEqual(['discord'])
    expect(linkableProviders('web', a)).toEqual([])
    expect(linkableProviders('ios', [...d, ...a])).toEqual([])
  })
})

describe('linkSignIn', () => {
  it('trades a Discord code and verifier through account:linkCode', async () => {
    const store = fakeStore()
    vi.mocked(store.portal).mockResolvedValue({ status: 'linked' })
    const native = vi.fn(async () => ({ code: 'c', verifier: 'v' }))
    const out = await linkSignIn('discord', { store, nativeSignIn: native as never })
    expect(out).toEqual({ status: 'linked' })
    expect(native).toHaveBeenCalledWith(expect.objectContaining({ intent: 'link' }))
    expect(store.portal).toHaveBeenCalledWith('account:linkCode', ['c', 'v'])
  })

  it('sends Apple results through account:linkApple', async () => {
    const store = fakeStore()
    vi.mocked(store.portal).mockResolvedValue({ status: 'already' })
    const appleSheet = vi.fn(async () => ({
      identityToken: 't',
      nonce: 'n',
      authorizationCode: 'a'
    }))
    await linkSignIn('apple', { store, appleSheet })
    expect(store.portal).toHaveBeenCalledWith('account:linkApple', [
      { identityToken: 't', nonce: 'n', authorizationCode: 'a' }
    ])
  })

  it('turns a failed sheet into readable copy, but passes the portal refusal on', async () => {
    const store = fakeStore()
    const failing = vi.fn(async () => {
      throw new Error('signin-failed')
    })
    await expect(linkSignIn('discord', { store, nativeSignIn: failing as never })).rejects.toThrow(
      "Couldn't link Discord"
    )
    await expect(linkSignIn('apple', { store, appleSheet: failing as never })).rejects.toThrow(
      "Couldn't link Apple"
    )
    vi.mocked(store.portal).mockRejectedValue(new Error('Too many changes today'))
    const ok = vi.fn(async () => ({ code: 'c', verifier: 'v' }))
    await expect(linkSignIn('discord', { store, nativeSignIn: ok as never })).rejects.toThrow(
      'Too many changes today'
    )
  })

  it('resolves null when the sheet is closed', async () => {
    const store = fakeStore()
    const native = vi.fn(async () => {
      throw new SignInCancelled()
    })
    expect(await linkSignIn('discord', { store, nativeSignIn: native as never })).toBeNull()
    expect(store.portal).not.toHaveBeenCalled()
  })
})

describe('MergeDialog', () => {
  it('pre-selects higher and labels each option with its total', async () => {
    render(<MergeDialog preview={PREVIEW} onMerge={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('radio', { name: 'Keep the higher count (12 cards)' })).toBeChecked()
    expect(
      screen.getByRole('radio', { name: "Keep only @seto's cards (10 cards)" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: "Keep only @kaiba's cards (7 cards)" })
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Add them together (17 cards)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '@seto' })).toBeChecked()
    expect(
      screen.getByText(
        'Let your other devices sync first. Devices signed in as @kaiba will be signed out; sign in again to see the merged account.'
      )
    ).toBeInTheDocument()
  })

  it("pre-selects the other account's username when this one's was never chosen", async () => {
    const fresh = {
      ...PREVIEW,
      mine: { ...PREVIEW.mine, username: 'duelist-k3m8qpza', usernameChosen: false },
      theirs: { ...PREVIEW.theirs, usernameChosen: true }
    }
    const { unmount } = render(<MergeDialog preview={fresh} onMerge={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('radio', { name: '@kaiba' })).toBeChecked()
    unmount()
    // Neither chosen (or both generated): this account's stays the default.
    const both = { ...fresh, theirs: { ...fresh.theirs, usernameChosen: false } }
    render(<MergeDialog preview={both} onMerge={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('radio', { name: '@duelist-k3m8qpza' })).toBeChecked()
  })

  it("warns that the other account's cards won't be kept, and merges with the choice", async () => {
    const user = userEvent.setup()
    const onMerge = vi.fn(async () => {})
    render(<MergeDialog preview={PREVIEW} onMerge={onMerge} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: "Keep only @kaiba's cards (7 cards)" }))
    expect(screen.getByText("@seto's cards won't be kept.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Merge accounts' }))
    expect(onMerge).toHaveBeenCalledWith({ cards: 'theirs', username: 'mine' })
  })

  it('shows a refusal from the server instead of crashing', async () => {
    const user = userEvent.setup()
    const onMerge = vi.fn(async () => {
      throw new Error('Too many changes today')
    })
    render(<MergeDialog preview={PREVIEW} onMerge={onMerge} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Merge accounts' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many changes today')
  })
})

describe('phone Settings linking', () => {
  beforeEach(() => {
    localStorage.clear()
    stubVideo()
    stubCamera()
    setOnline(true)
    build.platform = 'ios'
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    vi.mocked(nativeSignIn).mockReset()
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: vi.fn(async () => true), persisted: vi.fn(async () => true) }
    })
    stubFetch({ '/api/me': () => json({ error: 'unauthorized' }, 401) })
    window.history.replaceState(null, '', '/scan/')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    window.api = undefined as never
  })

  function setup(
    link: unknown,
    extra: Record<string, unknown> = {},
    user: Me = SETO
  ): {
    store: ReturnType<typeof fakeStore>
    signIns: ReturnType<typeof vi.fn>
  } {
    const signIns = vi.fn(async () => [{ provider: 'apple', addedAt: at }])
    const store = fakeStore({}, { account: { state: 'signed-in', user } })
    vi.mocked(store.portal).mockImplementation((async (channel: string) => {
      if (channel in extra) return extra[channel]
      if (channel === 'account:signIns') return signIns()
      if (channel === 'account:linkCode') return link
      if (channel === 'account:merge') return { ...SETO, username: 'seto' }
      return channel === 'friends:overview' ? { friends: [], incoming: [], blocked: [] } : []
    }) as PhoneStore['portal'])
    installPhoneApi(store)
    const engine = fakeEngine()
    render(<App store={store} onFatal={() => () => {}} engineFactory={() => engine} />)
    return { store, signIns }
  }
  async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const nav = await screen.findByRole('navigation', { name: 'Tabs' })
    await user.click(within(nav).getByRole('button', { name: 'More' }))
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    await user.click(within(sheet).getByRole('button', { name: 'Settings' }))
    await screen.findByRole('heading', { name: 'Settings' })
  }

  it('linking a free Discord shows Discord linked and refreshes the list', async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    const { signIns } = setup({ status: 'linked' })
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Discord linked'))
    await waitFor(() => expect(signIns.mock.calls.length).toBeGreaterThan(1))
  })

  it('says so when that account is already linked or the provider is taken', async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    setup({ status: 'already' })
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('That Discord account is already linked here')
    )
  })

  it("a failed sign-in sheet says Couldn't link Discord, never the raw code", async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockRejectedValue(new Error('signin-failed'))
    setup({ status: 'linked' })
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't link Discord"))
  })

  it('adding an email that finds another account opens the merge dialog', async () => {
    const user = userEvent.setup()
    setup(
      { status: 'linked' },
      { 'account:addEmail': { status: 'merge', ticket: 'tk', preview: PREVIEW } },
      { ...SETO, emailSignIn: true }
    )
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Add email' }))
    const form = await screen.findByRole('dialog', { name: 'Add email sign-in' })
    await user.type(within(form).getByRole('textbox', { name: 'Email' }), 'kaiba@example.com')
    await user.type(within(form).getByLabelText('Password'), 'hunter22!')
    await user.click(within(form).getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('dialog', { name: 'Merge accounts' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Add email sign-in' })).toBeNull()
  })

  it('says the account already has a Discord sign-in when the portal refuses', async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    setup({ status: 'has-provider' })
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This account already has a Discord sign-in, so that one can't be added"
      )
    )
  })

  it('disables the Link buttons while a link is in progress', async () => {
    const user = userEvent.setup()
    let finish!: (v: { code: string; verifier: string }) => void
    vi.mocked(nativeSignIn).mockReturnValue(
      new Promise((r) => {
        finish = r
      }) as never
    )
    setup({ status: 'linked' })
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link Discord' })).toBeDisabled())
    finish({ code: 'c', verifier: 'v' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link Discord' })).toBeEnabled())
  })

  it('a cancelled sign-in sheet does nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockRejectedValue(new SignInCancelled())
    const { store } = setup({ status: 'linked' })
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() => expect(nativeSignIn).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(store.portal).not.toHaveBeenCalledWith('account:linkCode', expect.anything())
  })

  it('a server refusal is an error toast', async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    const store = fakeStore()
    vi.mocked(store.portal).mockImplementation((async (channel: string) => {
      if (channel === 'account:signIns') return [{ provider: 'apple', addedAt: at }]
      if (channel === 'account:linkCode') throw new Error('Too many changes today')
      return channel === 'friends:overview' ? { friends: [], incoming: [], blocked: [] } : []
    }) as PhoneStore['portal'])
    installPhoneApi(store)
    const engine = fakeEngine()
    render(<App store={store} onFatal={() => () => {}} engineFactory={() => engine} />)
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many changes today'))
  })

  const SYNC_FIRST = "Sync your cards first. You're offline or changes are still waiting."
  const order = (fn: unknown, i = 0): number =>
    (fn as ReturnType<typeof vi.fn>).mock.invocationCallOrder[i]
  const portalOrder = (store: PhoneStore, channel: string): number => {
    const calls = vi.mocked(store.portal).mock.calls
    const i = calls.findIndex(([c]) => c === channel)
    return i < 0 ? Infinity : vi.mocked(store.portal).mock.invocationCallOrder[i]
  }

  it('pushes an unsent add before linking, and again before account:merge', async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    const { store } = setup({ status: 'merge', ticket: 'tk', preview: PREVIEW })
    await openSettings(user)
    const s = store as ReturnType<typeof fakeStore>
    // A scanned card waits to be sent; a sync sends it.
    s.state.sync = { ...s.state.sync, waiting: 1 }
    vi.mocked(store.sync).mockClear()
    vi.mocked(store.sync).mockImplementation(async () => {
      s.state.sync = { ...s.state.sync, waiting: 0 }
      return { ...s.state.sync, changed: false, awaitingPrices: false }
    })
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    const dialog = await screen.findByRole('dialog', { name: 'Merge accounts' })
    expect(order(store.sync)).toBeLessThan(portalOrder(store, 'account:linkCode'))
    // Another add lands while the merge screen is open.
    s.state.sync = { ...s.state.sync, waiting: 1 }
    await user.click(within(dialog).getByRole('button', { name: 'Merge accounts' }))
    await waitFor(() =>
      expect(store.portal).toHaveBeenCalledWith('account:merge', expect.anything())
    )
    expect(order(store.sync, 1)).toBeLessThan(portalOrder(store, 'account:merge'))
    expect(order(store.sync, 1)).toBeGreaterThan(portalOrder(store, 'account:linkCode'))
  })

  it("won't link when the sync fails, and says why", async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    const { store } = setup({ status: 'linked' })
    await openSettings(user)
    vi.mocked(store.sync).mockRejectedValue(new Error('offline'))
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SYNC_FIRST))
    expect(nativeSignIn).not.toHaveBeenCalled()
    expect(store.portal).not.toHaveBeenCalledWith('account:linkCode', expect.anything())
  })

  it("won't link while changes are still waiting after the sync", async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    const { store } = setup({ status: 'linked' })
    await openSettings(user)
    const s = store as ReturnType<typeof fakeStore>
    s.state.sync = { ...s.state.sync, waiting: 2 }
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SYNC_FIRST))
    expect(nativeSignIn).not.toHaveBeenCalled()
  })

  it("won't merge when the sync before it fails", async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    const { store } = setup({ status: 'merge', ticket: 'tk', preview: PREVIEW })
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    const dialog = await screen.findByRole('dialog', { name: 'Merge accounts' })
    vi.mocked(store.sync).mockRejectedValue(new Error('offline'))
    await user.click(within(dialog).getByRole('button', { name: 'Merge accounts' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(SYNC_FIRST)
    expect(store.portal).not.toHaveBeenCalledWith('account:merge', expect.anything())
    // The person can try again once synced.
    expect(within(dialog).getByRole('button', { name: 'Merge accounts' })).toBeEnabled()
  })

  it('a merge opens the merge screen; choosing theirs sends the choice, then syncs', async () => {
    const user = userEvent.setup()
    vi.mocked(nativeSignIn).mockResolvedValue({ code: 'c', verifier: 'v' } as never)
    const { store } = setup({ status: 'merge', ticket: 'tk', preview: PREVIEW })
    await openSettings(user)
    await user.click(await screen.findByRole('button', { name: 'Link Discord' }))
    const dialog = await screen.findByRole('dialog', { name: 'Merge accounts' })
    expect(
      within(dialog).getByRole('radio', { name: 'Keep the higher count (12 cards)' })
    ).toBeChecked()
    await user.click(
      within(dialog).getByRole('radio', { name: "Keep only @kaiba's cards (7 cards)" })
    )
    expect(within(dialog).getByText("@seto's cards won't be kept.")).toBeInTheDocument()
    vi.mocked(store.sync).mockClear()
    await user.click(within(dialog).getByRole('button', { name: 'Merge accounts' }))
    await waitFor(() =>
      expect(store.portal).toHaveBeenCalledWith('account:merge', [
        'tk',
        { cards: 'theirs', username: 'mine' }
      ])
    )
    expect(store.updateUser).toHaveBeenCalled()
    await waitFor(() => expect(store.sync).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Merge accounts' })).toBeNull())
  })
})
