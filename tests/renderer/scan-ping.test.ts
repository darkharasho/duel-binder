import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playScanPing, scanPingOn, setScanPingOn } from '../../src/renderer/src/lib/scanPing'

const started = vi.fn()

class FakeContext {
  state = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn(async () => {})
  createOscillator(): unknown {
    return {
      frequency: {},
      connect: (next: unknown) => next,
      start: started,
      stop: vi.fn()
    }
  }
  createGain(): unknown {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn()
    }
  }
}

describe('the scan ping', () => {
  beforeEach(() => {
    localStorage.clear()
    started.mockClear()
    vi.stubGlobal('AudioContext', FakeContext)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is off until asked for, and stays silent then', () => {
    expect(scanPingOn()).toBe(false)
    playScanPing()
    expect(started).not.toHaveBeenCalled()
  })

  it('rings once turned on and stops when turned off', () => {
    setScanPingOn(true)
    expect(scanPingOn()).toBe(true)
    playScanPing()
    expect(started).toHaveBeenCalled()
    started.mockClear()
    setScanPingOn(false)
    playScanPing()
    expect(started).not.toHaveBeenCalled()
  })
})
