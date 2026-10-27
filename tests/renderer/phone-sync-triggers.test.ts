import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncTriggers } from '../../src/phone/syncTriggers'

type Event = 'online' | 'visible'

let listeners: Map<Event, Set<() => void>>
let isOnline: boolean
let isVisible: boolean

const fire = (event: Event): void => {
  for (const cb of listeners.get(event) ?? []) cb()
}

function setup(sync: () => Promise<unknown> = async () => {}): {
  spy: ReturnType<typeof vi.fn<() => Promise<unknown>>>
  triggers: ReturnType<typeof createSyncTriggers>
} {
  const spy = vi.fn(sync)
  const triggers = createSyncTriggers({
    sync: spy,
    online: () => isOnline,
    visible: () => isVisible,
    on: (event, cb) => {
      const set = listeners.get(event) ?? new Set()
      set.add(cb)
      listeners.set(event, set)
      return () => set.delete(cb)
    },
    setTimer: setTimeout,
    clearTimer: clearTimeout
  })
  return { spy, triggers }
}

beforeEach(() => {
  vi.useFakeTimers()
  listeners = new Map()
  isOnline = true
  isVisible = true
})
afterEach(() => {
  vi.useRealTimers()
})

describe('sync triggers', () => {
  it('two adds within 2 s give one sync', async () => {
    const { spy, triggers } = setup()
    triggers.afterAdd()
    await vi.advanceTimersByTimeAsync(1500)
    triggers.afterAdd()
    await vi.advanceTimersByTimeAsync(1999)
    expect(spy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(spy).toHaveBeenCalledTimes(1)
    triggers.dispose()
  })

  it('online triggers a sync', async () => {
    const { spy, triggers } = setup()
    fire('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(1)
    triggers.dispose()
  })

  it('becoming visible triggers a sync', async () => {
    const { spy, triggers } = setup()
    fire('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(1)
    triggers.dispose()
  })

  it('a trigger during a sync gives exactly one more', async () => {
    let release!: () => void
    let calls = 0
    const { spy, triggers } = setup(() => {
      calls++
      return calls === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve()
    })
    fire('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(1)
    fire('visible')
    fire('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10)
    expect(spy).toHaveBeenCalledTimes(2)
    triggers.dispose()
  })

  it('a failed sync does not stop the next one', async () => {
    const { spy, triggers } = setup(async () => {
      throw new Error('offline')
    })
    fire('online')
    await vi.advanceTimersByTimeAsync(0)
    fire('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(2)
    triggers.dispose()
  })

  it('syncs every 5 minutes while visible and online', async () => {
    const { spy, triggers } = setup()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(spy).toHaveBeenCalledTimes(1)
    isVisible = false
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(spy).toHaveBeenCalledTimes(1)
    isVisible = true
    isOnline = false
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(spy).toHaveBeenCalledTimes(1)
    isOnline = true
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(spy).toHaveBeenCalledTimes(2)
    triggers.dispose()
  })

  it('an add made offline waits for the online event', async () => {
    isOnline = false
    const { spy, triggers } = setup()
    triggers.afterAdd()
    await vi.advanceTimersByTimeAsync(2000)
    expect(spy).not.toHaveBeenCalled()
    isOnline = true
    fire('online')
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(1)
    triggers.dispose()
  })

  it('dispose stops every trigger', async () => {
    const { spy, triggers } = setup()
    triggers.afterAdd()
    triggers.dispose()
    fire('online')
    fire('visible')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(spy).not.toHaveBeenCalled()
    expect([...listeners.values()].every((s) => s.size === 0)).toBe(true)
  })
})
