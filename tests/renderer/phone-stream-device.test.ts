import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  on: false,
  enter: vi.fn(async () => ({})),
  exit: vi.fn(async () => ({}))
}))
vi.mock('@/lib/portal', () => ({ isNativeApp: () => native.on }))
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ enter: native.enter, exit: native.exit })
}))

import { enterStream, exitStream, reacquireStream } from '../../src/phone/stream/device'

const release = vi.fn(async () => {})
const request = vi.fn<(type: 'screen') => Promise<{ release: typeof release }>>(async () => ({
  release
}))

function setWakeLock(lock: unknown): void {
  Object.defineProperty(navigator, 'wakeLock', { value: lock, configurable: true })
}

beforeEach(() => {
  native.on = false
  vi.clearAllMocks()
  setWakeLock({ request })
})

describe('stream device control, web', () => {
  it('holds a screen wake lock and reports the screen awake', async () => {
    expect(await enterStream()).toEqual({ awake: true })
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('reports not awake, without throwing, when the lock is refused or missing', async () => {
    request.mockRejectedValueOnce(new Error('denied'))
    expect(await enterStream()).toEqual({ awake: false })
    setWakeLock(undefined)
    expect(await enterStream()).toEqual({ awake: false })
  })

  it('releases the lock on exit, once', async () => {
    await enterStream()
    await exitStream()
    await exitStream()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases every lock after two enters and one exit', async () => {
    const releases = [vi.fn(async () => {}), vi.fn(async () => {})]
    releases.forEach((r) => request.mockResolvedValueOnce({ release: r }))
    await Promise.all([enterStream(), enterStream()])
    await exitStream()
    expect(request).toHaveBeenCalledTimes(2)
    releases.forEach((r) => expect(r).toHaveBeenCalledTimes(1))
  })

  it('takes the lock again on reacquire', async () => {
    await enterStream()
    await reacquireStream()
    expect(request).toHaveBeenCalledTimes(2)
  })
})

describe('stream device control, native', () => {
  beforeEach(() => {
    native.on = true
  })

  it('asks the plugin to enter and exit, and requests no wake lock', async () => {
    expect(await enterStream()).toEqual({ awake: true })
    expect(native.enter).toHaveBeenCalledTimes(1)
    await exitStream()
    expect(native.exit).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()
  })

  it('reports not awake, without throwing, when the plugin is missing', async () => {
    native.enter.mockRejectedValueOnce(new Error('not implemented'))
    native.exit.mockRejectedValueOnce(new Error('not implemented'))
    expect(await enterStream()).toEqual({ awake: false })
    await expect(exitStream()).resolves.toBeUndefined()
  })
})
