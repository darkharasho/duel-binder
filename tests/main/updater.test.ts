import { EventEmitter } from 'events'
import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { createUpdater, updateMode, RELEASES_URL } from '../../src/main/updater'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  quitAndInstall = vi.fn()
  checkForUpdates = vi.fn(async () => null)
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
    expect(await updater.check()).toEqual({ state: 'none', mode: 'auto', version: null, error: null })
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

  it('a rejected check becomes error status instead of throwing', async () => {
    const { fake, updater } = setup('auto')
    fake.checkForUpdates.mockRejectedValue(new Error('boom'))
    expect(await updater.check()).toMatchObject({ state: 'error', error: 'boom' })
  })

  it('start checks immediately and then every 4 h', async () => {
    vi.useFakeTimers()
    const { fake, updater } = setup('auto')
    updater.start()
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(3)
    updater.stop()
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(3)
  })
})
