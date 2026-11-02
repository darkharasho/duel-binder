import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateBanner } from '../../src/phone/UpdateBanner'
import {
  UPDATE_CHECKED_KEY,
  UPDATE_DISMISSED_KEY,
  checkForUpdate
} from '../../src/phone/updateCheck'

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
const release = (tag = 'v0.48.0'): Response =>
  new Response(
    JSON.stringify({
      tag_name: tag,
      assets: [{ name: `Duel-Binder-${tag.slice(1)}.apk`, size: 1, browser_download_url: APK_URL }]
    }),
    { status: 200 }
  )

const DAY = 24 * 60 * 60 * 1000

type CheckDeps = Parameters<typeof checkForUpdate>[0]

function deps(over: Partial<CheckDeps> = {}): CheckDeps {
  return {
    fetch: vi.fn(async () => release()) as unknown as typeof fetch,
    now: () => 1_000_000_000_000,
    storage: localStorage,
    current: '0.47.0',
    ...over
  }
}

beforeEach(() => {
  localStorage.clear()
  build.platform = 'android'
  build.channel = 'apk'
})

describe('checkForUpdate', () => {
  it('finds a newer APK', async () => {
    const d = deps()
    await expect(checkForUpdate(d)).resolves.toEqual({ version: '0.48.0', url: APK_URL })
    expect(d.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/darkharasho/duel-binder/releases/latest',
      expect.anything()
    )
  })

  it('finds nothing when this is the latest', async () => {
    await expect(checkForUpdate(deps({ current: '0.48.0' }))).resolves.toBeNull()
  })

  it('finds nothing, quietly, offline or when GitHub refuses', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(checkForUpdate(deps({ fetch: offline }))).resolves.toBeNull()
    localStorage.clear()
    const refused = vi.fn(async () => new Response('rate limited', { status: 403 }))
    await expect(
      checkForUpdate(deps({ fetch: refused as unknown as typeof fetch }))
    ).resolves.toBeNull()
  })

  it('asks GitHub at most once a day, and remembers what it found', async () => {
    const first = deps()
    await checkForUpdate(first)
    expect(localStorage.getItem(UPDATE_CHECKED_KEY)).not.toBeNull()

    const soon = deps({ now: () => 1_000_000_000_000 + DAY - 1 })
    await expect(checkForUpdate(soon)).resolves.toEqual({ version: '0.48.0', url: APK_URL })
    expect(soon.fetch).not.toHaveBeenCalled()

    const nextDay = deps({ now: () => 1_000_000_000_000 + DAY })
    await checkForUpdate(nextDay)
    expect(nextDay.fetch).toHaveBeenCalledTimes(1)
  })

  it('tries again the next day after a failed check', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await checkForUpdate(deps({ fetch: offline }))
    const later = deps({ now: () => 1_000_000_000_000 + DAY })
    await expect(checkForUpdate(later)).resolves.toEqual({ version: '0.48.0', url: APK_URL })
  })
})

describe('UpdateBanner', () => {
  const found = async (): Promise<{ version: string; url: string }> => ({
    version: '0.48.0',
    url: APK_URL
  })

  it('links to the newer APK', async () => {
    render(<UpdateBanner check={found} />)
    const link = await screen.findByRole('link', { name: 'Update to 0.48.0' })
    expect(link).toHaveAttribute('href', APK_URL)
  })

  it('shows nothing when there is no update', async () => {
    const check = vi.fn(async () => null)
    render(<UpdateBanner check={check} />)
    await vi.waitFor(() => expect(check).toHaveBeenCalled())
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('stays hidden for that version once dismissed', async () => {
    const user = userEvent.setup()
    const view = render(<UpdateBanner check={found} />)
    await user.click(await screen.findByRole('button', { name: 'Dismiss update' }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(localStorage.getItem(UPDATE_DISMISSED_KEY)).toBe('0.48.0')
    view.unmount()

    const check = vi.fn(found)
    render(<UpdateBanner check={check} />)
    await vi.waitFor(() => expect(check).toHaveBeenCalled())
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('only the APK build of the Android app checks', async () => {
    for (const [platform, channel] of [
      ['web', 'apk'],
      ['ios', 'apk'],
      ['android', 'play']
    ] as const) {
      build.platform = platform
      build.channel = channel
      const check = vi.fn(found)
      const view = render(<UpdateBanner check={check} />)
      await new Promise((r) => setTimeout(r, 0))
      expect(check, `${platform} ${channel}`).not.toHaveBeenCalled()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      view.unmount()
    }
  })
})
