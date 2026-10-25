import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncScheduler, type SyncScheduler } from '../../src/main/cloud/scheduler'

let online = true
let scheduler: SyncScheduler | null = null

const make = (
  run: () => Promise<void>,
  opts: Partial<Parameters<typeof createSyncScheduler>[0]> = {}
): SyncScheduler => {
  scheduler = createSyncScheduler({ run, isOnline: () => online, ...opts })
  return scheduler
}

beforeEach(() => {
  vi.useFakeTimers()
  online = true
})

afterEach(() => {
  scheduler?.stop()
  scheduler = null
  vi.useRealTimers()
})

describe('createSyncScheduler', () => {
  it('runs once at start', async () => {
    const run = vi.fn(async () => {})
    make(run).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('debounces edits into one run 5 s after the last', async () => {
    const run = vi.fn(async () => {})
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(0)
    run.mockClear()
    s.poke()
    await vi.advanceTimersByTimeAsync(3_000)
    s.poke()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('poke with a delay runs then', async () => {
    const run = vi.fn(async () => {})
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(0)
    run.mockClear()
    s.poke(20_000)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('an edit poke runs first and a pending 20 s follow-up still runs', async () => {
    const run = vi.fn(async () => {})
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(0)
    run.mockClear()
    s.poke(20_000)
    await vi.advanceTimersByTimeAsync(1_000)
    s.poke()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(13_999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('of two delayed pokes the earlier deadline wins', async () => {
    const run = vi.fn(async () => {})
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(0)
    run.mockClear()
    s.poke(20_000)
    s.poke(30_000)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(run).toHaveBeenCalledTimes(1)
    s.poke(30_000)
    s.poke(10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('tells the caller when a run is skipped offline', async () => {
    online = false
    const onSkippedOffline = vi.fn()
    const run = vi.fn(async () => {})
    const s = make(run, { onSkippedOffline })
    s.start()
    expect(onSkippedOffline).toHaveBeenCalledTimes(1)
    await s.runNow()
    expect(onSkippedOffline).toHaveBeenCalledTimes(2)
    expect(run).not.toHaveBeenCalled()
  })

  it('stop releases runNow callers waiting on a run in flight', async () => {
    const run = vi.fn(async () => {})
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(0)
    run.mockImplementation(() => new Promise<void>(() => {}))
    const waiting = s.runNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
    s.stop()
    await expect(waiting).resolves.toBeUndefined()
  })

  it('runs every 5 minutes', async () => {
    const run = vi.fn(async () => {})
    make(run).start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(299_999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('runs when the network comes back', async () => {
    online = false
    const run = vi.fn(async () => {})
    const s = make(run)
    s.start()
    s.poke()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(run).not.toHaveBeenCalled()
    online = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(1)
    // Staying online, the poll doesn't run it again.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('one run at a time; a request during a run queues one more', async () => {
    let active = 0
    let maxActive = 0
    const run = vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 1_000))
      active--
    })
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(100)
    const a = s.runNow()
    const b = s.runNow()
    s.poke(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all([a, b])
    expect(run).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
  })

  it('backs off after failures and resets after a success', async () => {
    let fail = true
    const run = vi.fn(async () => {
      if (fail) throw new Error('nope')
    })
    make(run).start()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(run).toHaveBeenCalledTimes(4)
    fail = false
    await vi.advanceTimersByTimeAsync(300_000)
    expect(run).toHaveBeenCalledTimes(5)
    // Success: back to the 5-minute period, and the next failure starts at 30 s again.
    fail = true
    await vi.advanceTimersByTimeAsync(300_000)
    expect(run).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(7)
  })

  it('a poke during backoff waits for the backoff to end', async () => {
    const run = vi.fn(async () => {
      throw new Error('400')
    })
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    s.poke()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('stop clears every timer', async () => {
    const run = vi.fn(async () => {})
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(0)
    s.poke()
    s.poke(20_000)
    s.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(run).toHaveBeenCalledTimes(1)
    // Stopped, requests are ignored and runNow resolves at once.
    s.poke()
    await s.runNow()
    expect(run).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop during a run schedules nothing after it', async () => {
    const run = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1_000))
    })
    const s = make(run)
    s.start()
    await vi.advanceTimersByTimeAsync(10)
    s.poke(0)
    s.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(vi.getTimerCount()).toBe(0)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
