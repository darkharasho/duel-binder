import { render, screen } from '@testing-library/react'
import { App } from '../../src/phone/App'
import { exitStream } from '../../src/phone/stream/device'
import { fakeEngine } from './scanFakes'
import { fakeStore, installPhoneApi } from './phoneFakes'

const native = vi.hoisted(() => ({ platform: 'web' as 'web' | 'ios' | 'android' }))
vi.mock('@/lib/portal', async (orig) => ({
  ...(await orig<typeof import('@/lib/portal')>()),
  get APP_PLATFORM() {
    return native.platform
  },
  isNativeApp: () => native.platform !== 'web'
}))
vi.mock('../../src/phone/stream/device', () => ({
  enterStream: vi.fn(async () => ({ awake: true })),
  reacquireStream: vi.fn(async () => {}),
  exitStream: vi.fn(async () => {})
}))

function renderApp(): void {
  const engine = fakeEngine()
  render(<App store={fakeStore()} onFatal={() => () => {}} engineFactory={() => engine} />)
}

beforeEach(() => vi.mocked(exitStream).mockClear())

describe('phone app start, native', () => {
  it('puts a reloaded page upright and free to sleep, once', () => {
    native.platform = 'ios'
    renderApp()
    expect(exitStream).toHaveBeenCalledTimes(1)
  })

  it('leaves the web alone', () => {
    native.platform = 'web'
    renderApp()
    expect(exitStream).not.toHaveBeenCalled()
  })
})

describe('phone app sign-in, native', () => {
  function renderSignedOut(): void {
    const store = fakeStore({}, { account: { state: 'signed-out' } })
    installPhoneApi(store)
    render(<App store={store} onFatal={() => () => {}} engineFactory={() => fakeEngine()} />)
  }

  it('offers Apple and Discord in the iOS app', async () => {
    native.platform = 'ios'
    renderSignedOut()
    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument()
  })

  it('offers only Discord in the Android app', async () => {
    native.platform = 'android'
    renderSignedOut()
    expect(await screen.findByRole('button', { name: 'Sign in with Discord' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in with Apple' })).not.toBeInTheDocument()
  })
})
