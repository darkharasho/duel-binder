import { EventEmitter } from 'events'
import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import {
  createUpdater,
  isNewer,
  updateMode,
  CHECK_INTERVAL_MS,
  RELEASES_URL,
  RESTART_CHECK_MS
} from '../../src/main/updater'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  quitAndInstall = vi.fn()
  checkForUpdates = vi.fn(async (): Promise<unknown> => null)
  downloadUpdate = vi.fn(async () => [])
}

/** The feed answers with `version` as the latest release, the way electron-updater does. */
function feed(fake: FakeUpdater, version: string): void {
  fake.checkForUpdates.mockImplementation(async () => {
    fake.emit('checking-for-update')
    fake.emit('update-available', { version })
    if (fake.autoDownload) fake.emit('update-downloaded', { version })
    return { isUpdateAvailable: true, updateInfo: { version } }
  })
}

function setup(mode: 'auto' | 'notify', enabled = true) {
  const fake = new FakeUpdater()
  const emitted: UpdateStatus[] = []
  const openExternal = vi.fn(async () => undefined)
  const updater = createUpdater({
    autoUpdater: fake as unknown as AppUpdater,
    mode,
    emit: (s) => emitted.push(s),
    openExternal,
    enabled
  })
  return { fake, emitted, openExternal, updater }
}

describe('updateMode', () => {
  it.each([
    ['darwin', false, 'notify'],
    ['darwin', true, 'auto'],
    ['linux', false, 'auto'],
    ['linux', true, 'auto']
  ] as const)('%s signed=%s -> %s', (platform, signed, expected) => {
    expect(updateMode(platform, signed)).toBe(expected)
  })
})

describe('createUpdater', () => {
  afterEach(() => vi.useRealTimers())

  it('auto mode reaches ready and apply calls quitAndInstall', async () => {
    const { fake, emitted, updater } = setup('auto')
    expect(fake.autoDownload).toBe(true)
    expect(fake.autoInstallOnAppQuit).toBe(true)
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('checking-for-update')
      fake.emit('update-available', { version: '1.2.0' })
      return null
    })
    await updater.check()
    fake.emit('download-progress', { percent: 50 })
    fake.emit('update-downloaded', { version: '1.2.0' })
    expect(emitted.map((s) => s.state)).toEqual(['checking', 'available', 'downloading', 'ready'])
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
    await updater.apply()
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('notify mode never downloads and apply opens the release tag URL', async () => {
    const { fake, openExternal, updater } = setup('notify')
    expect(fake.autoDownload).toBe(false)
    expect(fake.autoInstallOnAppQuit).toBe(false)
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('update-available', { version: '1.2.0' })
      return null
    })
    const status = await updater.check()
    expect(status).toMatchObject({ state: 'available', mode: 'notify', version: '1.2.0' })
    await updater.apply()
    expect(openExternal).toHaveBeenCalledWith(`${RELEASES_URL}/tag/v1.2.0`)
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
  })

  it('disabled updater does not check', async () => {
    const { fake, updater } = setup('auto', false)
    expect(await updater.check()).toEqual({
      state: 'none',
      mode: 'auto',
      version: null,
      error: null
    })
    expect(fake.checkForUpdates).not.toHaveBeenCalled()
  })

  it('error event becomes error status', async () => {
    const { fake, updater } = setup('auto')
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('error', new Error('offline'))
      return null
    })
    expect(await updater.check()).toMatchObject({ state: 'error', error: 'offline' })
  })

  it('check while ready keeps ready when no later release is out', async () => {
    const { fake, emitted, updater } = setup('auto')
    fake.emit('update-downloaded', { version: '1.2.0' })
    feed(fake, '1.2.0')
    expect(await updater.check()).toMatchObject({ state: 'ready', version: '1.2.0' })
    expect(emitted.map((s) => s.state)).toEqual(['ready'])
    expect(fake.downloadUpdate).not.toHaveBeenCalled()
    expect(fake.autoDownload).toBe(true)
  })

  it('check while ready fetches a later release instead', async () => {
    const { fake, updater } = setup('auto')
    fake.emit('update-downloaded', { version: '1.2.0' })
    feed(fake, '1.2.1')
    expect(await updater.check()).toMatchObject({ state: 'available', version: '1.2.1' })
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1)
    fake.emit('update-downloaded', { version: '1.2.1' })
    expect(updater.status()).toMatchObject({ state: 'ready', version: '1.2.1' })
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
  })

  it('a failed check while ready keeps the downloaded update', async () => {
    const { fake, updater } = setup('auto')
    fake.emit('update-downloaded', { version: '1.2.0' })
    fake.checkForUpdates.mockImplementation(async () => {
      fake.emit('error', new Error('offline'))
      throw new Error('offline')
    })
    expect(await updater.check()).toMatchObject({ state: 'ready', version: '1.2.0' })
  })

  it('restart with a later release out downloads it, then installs that one', async () => {
    const { fake, updater } = setup('auto')
    fake.emit('update-downloaded', { version: '1.2.0' })
    feed(fake, '1.2.1')
    await updater.apply()
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1)
    fake.emit('update-downloaded', { version: '1.2.1' })
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('restart does not wait long on a slow feed', async () => {
    vi.useFakeTimers()
    const { fake, updater } = setup('auto')
    fake.emit('update-downloaded', { version: '1.2.0' })
    fake.checkForUpdates.mockImplementation(() => new Promise(() => undefined))
    const applying = updater.apply()
    await vi.advanceTimersByTimeAsync(RESTART_CHECK_MS)
    await applying
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('a rejected check becomes error status instead of throwing', async () => {
    const { fake, updater } = setup('auto')
    fake.checkForUpdates.mockRejectedValue(new Error('boom'))
    expect(await updater.check()).toMatchObject({ state: 'error', error: 'boom' })
  })

  it('start checks immediately and then every hour', async () => {
    vi.useFakeTimers()
    const { fake, updater } = setup('auto')
    updater.start()
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(3)
    updater.stop()
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(3)
  })
})

describe('isNewer', () => {
  it.each([
    ['0.58.1', '0.58.0', true],
    ['0.59.0', '0.58.9', true],
    ['0.58.10', '0.58.9', true],
    ['0.58.0', '0.58.0', false],
    ['0.57.9', '0.58.0', false],
    ['1.0.0', null, true]
  ] as const)('%s after %s -> %s', (a, b, expected) => {
    expect(isNewer(a, b)).toBe(expected)
  })
})
