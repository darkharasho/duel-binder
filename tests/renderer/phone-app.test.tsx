import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/phone/App'
import {
  FIRST_RUN_CELLULAR,
  FIRST_RUN_SIZE,
  FIRST_RUN_STOPPED,
  OPEN_ELSEWHERE,
  SIGN_IN_COPY,
  SIGN_IN_FAILED,
  SIGN_OUT_FAILED,
  UNSUPPORTED
} from '../../src/phone/copy'
import { DB_OPEN_ELSEWHERE } from '../../src/phone/data/openRetry'
import { createPhoneRuntime, type WorkerLike } from '../../src/phone/runtime'
import type { PhoneStore } from '../../src/phone/data/store'
import { DELETE_WARNING } from '@/features/settings/accountText'
import { fakeEngine, stubCamera, stubVideo } from './scanFakes'
import { SETO, fakeOcr, fakeStore, installPhoneApi, json, setOnline, stubFetch } from './phoneFakes'

/** The phone scanner's saved list of unsaved scans, and whose they are (see savedScans.ts). */
const SESSION_KEY = 'scan.session.v1'
const OWNER_KEY = 'scan.session.owner'
const savedScan = (): Record<string, unknown> => ({
  key: '101:46986414',
  cardId: 1,
  name: 'Dark Magician',
  imageId: 46986414,
  printingId: 101,
  setCode: 'LOB-EN005',
  rarity: 'Ultra Rare',
  options: [],
  flag: null,
  via: 'code',
  quantity: 1,
  addedAt: 1
})

type OnFatal = (cb: (message: string) => void) => () => void
const noFatal: OnFatal = () => () => {}

function renderApp(store: PhoneStore, onFatal: OnFatal = noFatal): ReturnType<typeof render> {
  const engine = fakeEngine()
  return render(<App store={store} onFatal={onFatal} engineFactory={() => engine} />)
}

const tab = (name: string): HTMLElement =>
  within(screen.getByRole('navigation', { name: 'Tabs' })).getByRole('button', { name })

beforeEach(() => {
  localStorage.clear()
  stubVideo()
  stubCamera()
  setOnline(true)
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persist: vi.fn(async () => true), persisted: vi.fn(async () => true) }
  })
  // Signed out of the web too, unless a test says otherwise.
  stubFetch({ '/api/me': () => json({ error: 'unauthorized' }, 401) })
  window.history.replaceState(null, '', '/scan/')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.api = undefined as never
})

describe('phone app', () => {
  it('shows the unsupported screen when the data worker fails to open', async () => {
    const listeners: ((e: MessageEvent) => void)[] = []
    const worker: WorkerLike = {
      postMessage: vi.fn(),
      addEventListener: (_type: string, l: (e: MessageEvent) => void) => {
        listeners.push(l)
      }
    }
    const rt = createPhoneRuntime({ worker, ocr: fakeOcr() })
    window.api = rt.api
    // Posted before the app mounts: the runtime keeps it for the app.
    for (const l of listeners) l(new MessageEvent('message', { data: { fatal: 'no OPFS' } }))
    renderApp(rt.store, rt.onFatal)
    expect(await screen.findByText(UNSUPPORTED)).toBeInTheDocument()
    rt.dispose()
  })

  it('says the app is open in another tab when the database is held there', async () => {
    const listeners: ((e: MessageEvent) => void)[] = []
    const worker: WorkerLike = {
      postMessage: vi.fn(),
      addEventListener: (_type: string, l: (e: MessageEvent) => void) => {
        listeners.push(l)
      }
    }
    const rt = createPhoneRuntime({ worker, ocr: fakeOcr() })
    window.api = rt.api
    renderApp(rt.store, rt.onFatal)
    // After mount: the pending account() call fails with the same fatal, and must not win.
    act(() => {
      for (const l of listeners)
        l(new MessageEvent('message', { data: { fatal: DB_OPEN_ELSEWHERE } }))
    })
    expect(await screen.findByText(OPEN_ELSEWHERE)).toBeInTheDocument()
    expect(screen.queryByText(UNSUPPORTED)).not.toBeInTheDocument()
    rt.dispose()
  })

  it('shows the unsupported screen when the failure comes after the app mounts', async () => {
    let fail: (message: string) => void = () => {}
    const store = fakeStore({ account: vi.fn(() => new Promise<never>(() => {})) })
    installPhoneApi(store)
    renderApp(store, (cb) => {
      fail = cb
      return () => {}
    })
    act(() => fail('no OPFS'))
    expect(await screen.findByText(UNSUPPORTED)).toBeInTheDocument()
  })

  it('opens on Scan', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await waitFor(() => expect(tab('Scan')).toHaveAttribute('aria-current', 'page'))
    expect(screen.getByRole('button', { name: /0 scanned · Review/ })).toBeInTheDocument()
  })

  it('every tab opens its page', async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await screen.findByRole('navigation', { name: 'Tabs' })

    await user.click(tab('Home'))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(tab('Home')).toHaveAttribute('aria-current', 'page')

    await user.click(tab('Collection'))
    expect(await screen.findByRole('heading', { name: 'Collection' })).toBeInTheDocument()

    await user.click(tab('Sets'))
    expect(await screen.findByRole('heading', { name: 'Sets' })).toBeInTheDocument()

    for (const name of ['Browse', 'Friends', 'Settings']) {
      await user.click(tab('More'))
      const sheet = await screen.findByRole('dialog', { name: 'More' })
      await user.click(within(sheet).getByRole('button', { name }))
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
      expect(tab('More')).toHaveAttribute('aria-current', 'page')
    }
    // The phone's own Settings, not the desktop one.
    expect(screen.getByText('Signed in as Seto')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument()
  })

  it('signs in from an existing web session without a click', async () => {
    const store = fakeStore({}, { account: { state: 'signed-out' } })
    installPhoneApi(store)
    const fetch = stubFetch({
      '/api/me': () => json(SETO),
      '/auth/phone/token': () => json({ token: 'tok-1', user: SETO })
    })
    renderApp(store)
    await waitFor(() => expect(store.signIn).toHaveBeenCalledWith('tok-1', SETO))
    const [, init] = fetch.mock.calls.find(([url]) => url === '/auth/phone/token')!
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(await screen.findByRole('navigation', { name: 'Tabs' })).toBeInTheDocument()
  })

  it('does not trade the cookie again when already signed in', async () => {
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await screen.findByRole('navigation', { name: 'Tabs' })
    expect(fetch).not.toHaveBeenCalledWith('/auth/phone/token', expect.anything())
    expect(store.signIn).not.toHaveBeenCalled()
  })

  it('signed out shows the Discord link with next=scan', async () => {
    const store = fakeStore({}, { account: { state: 'signed-out' } })
    installPhoneApi(store)
    renderApp(store)
    expect(await screen.findByText(SIGN_IN_COPY)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Sign in with Discord' })).toHaveAttribute(
      'href',
      '/auth/discord/start?next=scan'
    )
    expect(screen.queryByText(SIGN_IN_FAILED)).not.toBeInTheDocument()
  })

  it('a failed sign-in says so', async () => {
    window.history.replaceState(null, '', '/scan/?signin=failed')
    const store = fakeStore({}, { account: { state: 'signed-out' } })
    installPhoneApi(store)
    renderApp(store)
    expect(await screen.findByText(SIGN_IN_FAILED)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Sign in with Discord' })).toBeInTheDocument()
  })

  it('first run shows progress then the scanner', async () => {
    let finish: () => void = () => {}
    const store = fakeStore(
      {
        fillCatalog: vi.fn(
          (onProgress: (p: { cursor: number; latest: number }) => void) =>
            new Promise<void>((resolve) => {
              onProgress({ cursor: 25, latest: 100 })
              finish = resolve
            })
        )
      },
      { catalog: { filled: false, cursor: 0, latest: null, lastSyncAt: null, dbVersion: null } }
    )
    installPhoneApi(store)
    renderApp(store)
    expect(
      await screen.findByRole('heading', { name: 'Downloading card data' })
    ).toBeInTheDocument()
    expect(screen.getByText(FIRST_RUN_SIZE)).toBeInTheDocument()
    // The size covers the app's own files too (about 20 MB in all, measured).
    expect(FIRST_RUN_SIZE).toBe('About 20 MB. Use Wi-Fi if you can.')
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    )
    await act(async () => finish())
    expect(await screen.findByRole('navigation', { name: 'Tabs' })).toBeInTheDocument()
    expect(tab('Scan')).toHaveAttribute('aria-current', 'page')
    expect(store.refreshFingerprints).toHaveBeenCalled()
  })

  it('first run on mobile data says so before downloading', async () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { type: 'cellular' }
    })
    const user = userEvent.setup()
    const store = fakeStore(
      {},
      { catalog: { filled: false, cursor: 0, latest: null, lastSyncAt: null, dbVersion: null } }
    )
    installPhoneApi(store)
    renderApp(store)
    expect(await screen.findByText(FIRST_RUN_CELLULAR)).toBeInTheDocument()
    expect(FIRST_RUN_CELLULAR).toBe("You're on mobile data. This download is about 20 MB.")
    expect(store.fillCatalog).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(await screen.findByRole('navigation', { name: 'Tabs' })).toBeInTheDocument()
    Reflect.deleteProperty(navigator, 'connection')
  })

  it('first run failure offers Retry and resumes', async () => {
    const user = userEvent.setup()
    const fillCatalog = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(undefined)
    const store = fakeStore(
      { fillCatalog },
      { catalog: { filled: false, cursor: 40, latest: 100, lastSyncAt: null, dbVersion: null } }
    )
    installPhoneApi(store)
    renderApp(store)
    expect(await screen.findByText(FIRST_RUN_STOPPED)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('navigation', { name: 'Tabs' })).toBeInTheDocument()
    expect(fillCatalog).toHaveBeenCalledTimes(2)
  })

  it('status line shows Offline · 2 waiting to sync', async () => {
    setOnline(false)
    const store = fakeStore(
      {},
      { sync: { waiting: 2, problems: 0, lastSyncedAt: null, signedOut: false } }
    )
    installPhoneApi(store)
    renderApp(store)
    expect(await screen.findByText('Offline · 2 waiting to sync')).toBeInTheDocument()
  })

  it('status line follows the sync state', async () => {
    const user = userEvent.setup()
    const store = fakeStore(
      {},
      { sync: { waiting: 0, problems: 1, lastSyncedAt: null, signedOut: false } }
    )
    store.syncProblems = vi.fn(async () => [
      {
        uid: 'u1',
        name: 'Dark Magician',
        setCode: 'LOB-EN005',
        setName: 'Legend of Blue Eyes White Dragon',
        rarity: 'Ultra Rare',
        language: 'en' as const,
        quantity: 1,
        reason: 'unknown-printing'
      }
    ])
    installPhoneApi(store)
    renderApp(store)
    await user.click(await screen.findByRole('button', { name: "1 can't sync" }))
    const dialog = await screen.findByRole('dialog', { name: "Cards that can't sync" })
    expect(within(dialog).getByText('Dark Magician')).toBeInTheDocument()
    expect(within(dialog).getByText("This printing isn't on the server yet")).toBeInTheDocument()
  })

  it('warns that the browser may clear waiting adds when storage is not persistent', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: vi.fn(async () => false), persisted: vi.fn(async () => false) }
    })
    const store = fakeStore(
      {},
      { sync: { waiting: 1, problems: 0, lastSyncedAt: null, signedOut: false } }
    )
    installPhoneApi(store)
    renderApp(store)
    expect(await screen.findByText('1 waiting to sync')).toBeInTheDocument()
    expect(
      await screen.findByText(
        "Your browser may clear this app's data. Sync before closing it for long."
      )
    ).toBeInTheDocument()
    expect(navigator.storage.persist).toHaveBeenCalledTimes(1)
  })

  async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await screen.findByRole('navigation', { name: 'Tabs' })
    await user.click(tab('More'))
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    await user.click(within(sheet).getByRole('button', { name: 'Settings' }))
    await screen.findByRole('heading', { name: 'Settings' })
  }

  it('sign out warns when adds are waiting', async () => {
    const user = userEvent.setup()
    const store = fakeStore(
      {},
      { sync: { waiting: 2, problems: 0, lastSyncedAt: null, signedOut: false } }
    )
    installPhoneApi(store)
    const fetch = stubFetch({
      '/api/me': () => json({ error: 'unauthorized' }, 401),
      '/auth/logout': () => new Response(null, { status: 204 })
    })
    renderApp(store)
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sign out?' })
    expect(
      within(dialog).getByText(
        "2 cards haven't synced yet. They'll sync if you sign back in as Seto."
      )
    ).toBeInTheDocument()
    expect(store.signOut).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText(SIGN_IN_COPY)).toBeInTheDocument()
    expect(store.signOut).toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({ method: 'POST' }))
    // The cookie ended before the phone signed out, so sign-in didn't trade it back.
    const logout =
      fetch.mock.invocationCallOrder[fetch.mock.calls.findIndex(([url]) => url === '/auth/logout')]
    expect(logout).toBeLessThan(vi.mocked(store.signOut).mock.invocationCallOrder[0])
    expect(store.signIn).not.toHaveBeenCalled()
  })

  it('sign out with nothing waiting signs out at once', async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText(SIGN_IN_COPY)).toBeInTheDocument()
    expect(store.signOut).toHaveBeenCalled()
  })

  it('delete account asks first and returns to sign-in', async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete account' })
    expect(within(dialog).getByText(DELETE_WARNING)).toBeInTheDocument()
    expect(store.deleteAccount).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByText(SIGN_IN_COPY)).toBeInTheDocument()
    expect(store.deleteAccount).toHaveBeenCalledTimes(1)
  })

  it('delete account clears the unsaved scans on this phone', async () => {
    const user = userEvent.setup()
    localStorage.setItem(SESSION_KEY, JSON.stringify([savedScan()]))
    localStorage.setItem(OWNER_KEY, String(SETO.id))
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete account' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByText(SIGN_IN_COPY)).toBeInTheDocument()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(localStorage.getItem(OWNER_KEY)).toBeNull()
  })

  it('keeps the unsaved scans when the same user signs back in', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([savedScan()]))
    localStorage.setItem(OWNER_KEY, String(SETO.id))
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await screen.findByRole('navigation', { name: 'Tabs' })
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toHaveLength(1)
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(SETO.id))
  })

  it('drops the unsaved scans when a different user signs in', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify([savedScan()]))
    localStorage.setItem(OWNER_KEY, String(SETO.id + 1))
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await screen.findByRole('navigation', { name: 'Tabs' })
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(SETO.id))
  })

  it('a sign-out that fails says so and can be tried again', async () => {
    const user = userEvent.setup()
    const store = fakeStore({
      signOut: vi.fn(async () => {
        throw new Error("The app's data worker didn't start")
      })
    })
    installPhoneApi(store)
    stubFetch({
      '/api/me': () => json({ error: 'unauthorized' }, 401),
      '/auth/logout': () => new Response(null, { status: 204 })
    })
    renderApp(store)
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_OUT_FAILED)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
    expect(screen.queryByText(SIGN_IN_COPY)).not.toBeInTheDocument()
  })

  it('a card data refresh that fails ends with an error and can be tried again', async () => {
    const user = userEvent.setup()
    const store = fakeStore({
      refreshFingerprints: vi.fn(async (opts?: { force?: boolean }) => {
        if (opts?.force) throw new Error("The app's data worker didn't start")
        return { state: 'ready' as const, count: 1 }
      })
    })
    installPhoneApi(store)
    renderApp(store)
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: 'Refresh card data' }))
    expect(
      await screen.findByText("Couldn't refresh the artwork data. Try again later.")
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh card data' })).toBeEnabled()
  })

  it('a sync that finds the session ended returns to sign-in', async () => {
    const store = fakeStore()
    const { api } = installPhoneApi(store)
    renderApp(store)
    await screen.findByRole('navigation', { name: 'Tabs' })
    store.state.account = { state: 'signed-out' }
    await act(async () => {
      await api.account.syncNow()
    })
    expect(await screen.findByText(SIGN_IN_COPY)).toBeInTheDocument()
  })

  it('settings refreshes card data and shows the data date, version and privacy link', async () => {
    const user = userEvent.setup()
    const store = fakeStore()
    installPhoneApi(store)
    renderApp(store)
    await openSettings(user)
    expect(screen.getAllByText('Card data from Oct 27').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      'https://duelbinder.com/privacy'
    )
    expect(await screen.findByText(/Version dev/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh card data' }))
    await waitFor(() => expect(store.updateCatalog).toHaveBeenCalledWith({ force: true }))
    await waitFor(() => expect(store.refreshFingerprints).toHaveBeenCalledWith({ force: true }))
    expect(await screen.findByText('Card data is up to date.')).toBeInTheDocument()
  })
})
