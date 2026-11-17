import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateBanner } from '../../src/phone/UpdateBanner'
import { SHELL_UPDATE_KEY as LIVE_SHELL_KEY } from '../../src/phone/liveUpdate'
import { SHELL_UPDATE_KEY, UPDATE_DISMISSED_KEY, readShellUpdate } from '../../src/phone/updateCheck'

const build = vi.hoisted(() => ({
  platform: 'android' as 'web' | 'ios' | 'android',
  channel: 'apk' as 'apk' | 'play'
}))
vi.mock('@/lib/portal', async (orig) => ({
  ...(await orig<typeof import('@/lib/portal')>()),
  get APP_PLATFORM() {
    return build.platform
  },
  get ANDROID_CHANNEL() {
    return build.channel
  }
}))

const APK_URL =
  'https://github.com/darkharasho/duel-binder/releases/download/v0.48.0/Duel-Binder-0.48.0.apk'
const SHELL_KEY = 'duelbinder.shellUpdate'
const store = (v: unknown = { version: '0.48.0', url: APK_URL }): void =>
  localStorage.setItem(SHELL_KEY, JSON.stringify(v))

beforeEach(() => {
  localStorage.clear()
  build.platform = 'android'
  build.channel = 'apk'
  vi.stubGlobal('__APP_VERSION__', '0.47.0')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

it('one shell-update key, shared by the live-update check and the banner', () => {
  expect(SHELL_UPDATE_KEY).toBe(SHELL_KEY)
  expect(LIVE_SHELL_KEY).toBe(SHELL_UPDATE_KEY)
})

describe('readShellUpdate', () => {
  it('reads a stored update and tolerates bad storage', () => {
    expect(readShellUpdate(localStorage)).toBeNull()
    store()
    expect(readShellUpdate(localStorage)).toEqual({ version: '0.48.0', url: APK_URL })
    localStorage.setItem(SHELL_KEY, '{not json')
    expect(readShellUpdate(localStorage)).toBeNull()
    store({ version: 1 })
    expect(readShellUpdate(localStorage)).toBeNull()
    localStorage.setItem(SHELL_KEY, 'null')
    expect(readShellUpdate(localStorage)).toBeNull()
  })
})

describe('UpdateBanner', () => {
  it('banner: shows stored shellUpdate on the APK build', async () => {
    store()
    render(<UpdateBanner />)
    const link = await screen.findByRole('link', { name: 'Update to 0.48.0' })
    expect(link).toHaveAttribute('href', APK_URL)
  })

  it('shows nothing when none is stored', () => {
    render(<UpdateBanner />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('banner: hidden on Play and iOS', () => {
    store()
    for (const [platform, channel] of [
      ['web', 'apk'],
      ['ios', 'apk'],
      ['android', 'play']
    ] as const) {
      build.platform = platform
      build.channel = channel
      const view = render(<UpdateBanner />)
      expect(screen.queryByRole('link'), `${platform} ${channel}`).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('banner: dismissed version stays hidden', async () => {
    store()
    const user = userEvent.setup()
    const view = render(<UpdateBanner />)
    await user.click(await screen.findByRole('button', { name: 'Dismiss update' }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(localStorage.getItem(UPDATE_DISMISSED_KEY)).toBe('0.48.0')
    view.unmount()

    render(<UpdateBanner />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('banner: hidden once this build is that version or newer (just installed the APK)', () => {
    store()
    for (const v of ['0.48.0', '0.49.0']) {
      vi.stubGlobal('__APP_VERSION__', v)
      const view = render(<UpdateBanner />)
      expect(screen.queryByRole('link'), v).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('banner: appears when liveUpdate stores one later', async () => {
    render(<UpdateBanner />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    store()
    act(() => {
      window.dispatchEvent(new Event('duelbinder:shell-update'))
    })
    expect(await screen.findByRole('link', { name: 'Update to 0.48.0' })).toBeInTheDocument()
  })
})
