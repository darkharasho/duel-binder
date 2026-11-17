import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveUpdate } from '../../src/phone/liveUpdate'
import { SHOWN_KEY } from '../../src/phone/liveUpdate'
import { updatedNote, useHomeIdleSwitch } from '../../src/phone/liveUpdateSwitch'

const BUNDLE = { id: 'id-1', version: '0.103.2' }

function fakeLive(
  pending: { id: string; version: string } | null = BUNDLE,
  ready: Promise<void> = Promise.resolve()
) {
  const state = { pending }
  const live: LiveUpdate = {
    check: vi.fn(async () => undefined),
    pending: vi.fn(() => state.pending),
    ready: vi.fn(() => ready),
    applyNow: vi.fn(async () => undefined),
    dispose: vi.fn()
  }
  return { live, state }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  document.documentElement.classList.remove('live-update-fade')
  document.querySelectorAll('[role="dialog"]').forEach((e) => e.remove())
})

const flush = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('useHomeIdleSwitch', () => {
  it('switch: applies after 2 s idle on Home', async () => {
    const { live } = fakeLive()
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    await flush(1999)
    expect(live.applyNow).not.toHaveBeenCalled()
    await flush(1)
    expect(document.documentElement.classList.contains('live-update-fade')).toBe(true)
    expect(live.applyNow).not.toHaveBeenCalled()
    await flush(150)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
  })

  it('switch: a touch at 1.9 s restarts the wait', async () => {
    const { live } = fakeLive()
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    await flush(1900)
    document.dispatchEvent(new Event('touchstart'))
    await flush(1900)
    expect(live.applyNow).not.toHaveBeenCalled()
    await flush(300)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
  })

  it('switch: an open dialog blocks the switch', async () => {
    const { live } = fakeLive()
    const dlg = document.createElement('div')
    dlg.setAttribute('role', 'dialog')
    document.body.appendChild(dlg)
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    await flush(5000)
    expect(live.applyNow).not.toHaveBeenCalled()
    dlg.remove()
    await flush(2300)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
  })

  it('switch: a running sync blocks the switch', async () => {
    const { live } = fakeLive()
    let busy = true
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => busy }))
    await flush(5000)
    expect(live.applyNow).not.toHaveBeenCalled()
    busy = false
    await flush(2300)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
  })

  it('switch: leaving Home cancels', async () => {
    const { live } = fakeLive()
    const { rerender } = renderHook(
      ({ page }: { page: 'dashboard' | 'settings' }) =>
        useHomeIdleSwitch(page, { live, syncing: async () => false }),
      { initialProps: { page: 'dashboard' as 'dashboard' | 'settings' } }
    )
    await flush(1000)
    rerender({ page: 'settings' })
    await flush(5000)
    expect(live.applyNow).not.toHaveBeenCalled()
  })

  it('switch: a touch during the fade still switches', async () => {
    const { live } = fakeLive()
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    await flush(2100)
    document.dispatchEvent(new Event('touchstart'))
    window.dispatchEvent(new Event('duelbinder:live-pending'))
    await flush(50)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
    await flush(5000)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
  })

  it('switch: a touch while the sync check runs restarts the wait', async () => {
    const { live } = fakeLive()
    let release: (v: boolean) => void = () => undefined
    const syncing = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise<boolean>((r) => (release = r)))
      .mockResolvedValue(false)
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing }))
    await flush(2000)
    document.dispatchEvent(new Event('touchstart'))
    release(false)
    await flush(1999)
    expect(live.applyNow).not.toHaveBeenCalled()
    await flush(1)
    await flush(150)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
    await flush(5000)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
  })

  it('switch: a failed apply retries on Home', async () => {
    const { live } = fakeLive()
    vi.mocked(live.applyNow).mockRejectedValueOnce(new Error('x'))
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    await flush(2150)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains('live-update-fade')).toBe(false)
    await flush(2150)
    expect(live.applyNow).toHaveBeenCalledTimes(2)
  })

  it('switch: a rejected apply that clears pending does not re-arm', async () => {
    const { live, state } = fakeLive()
    vi.mocked(live.applyNow).mockImplementationOnce(async () => {
      state.pending = null
      throw new Error('x')
    })
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    await flush(2150)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('touchstart'))
    await flush(10_000)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(document.documentElement.classList.contains('live-update-fade')).toBe(false)
  })

  it('switch: does not arm before start-up reconciliation finishes', async () => {
    let done: () => void = () => undefined
    const { live, state } = fakeLive(BUNDLE, new Promise<void>((r) => (done = r)))
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    document.dispatchEvent(new Event('touchstart'))
    window.dispatchEvent(new Event('duelbinder:live-pending'))
    await flush(5000)
    expect(live.applyNow).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    // reconciliation found the entry stale (it is the running bundle): still nothing
    state.pending = null
    done()
    await flush(5000)
    expect(live.applyNow).not.toHaveBeenCalled()
  })

  it('switch: arms once reconciliation keeps a pending bundle', async () => {
    let done: () => void = () => undefined
    const { live } = fakeLive(BUNDLE, new Promise<void>((r) => (done = r)))
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    await flush(3000)
    expect(live.applyNow).not.toHaveBeenCalled()
    done()
    await flush(2150)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
  })

  it('switch: nothing pending, nothing armed', async () => {
    const { live } = fakeLive(null)
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    document.dispatchEvent(new Event('touchstart'))
    await flush(5000)
    expect(vi.getTimerCount()).toBe(0)
    expect(live.applyNow).not.toHaveBeenCalled()
  })

  it('switch: a download finishing on Home arms the switch', async () => {
    const { live, state } = fakeLive(null)
    renderHook(() => useHomeIdleSwitch('dashboard', { live, syncing: async () => false }))
    await flush(3000)
    state.pending = BUNDLE
    window.dispatchEvent(new Event('duelbinder:live-pending'))
    await flush(2000)
    expect(live.applyNow).not.toHaveBeenCalled()
    await flush(150)
    expect(live.applyNow).toHaveBeenCalledTimes(1)
  })
})

describe('updatedNote', () => {
  function mem(): Storage {
    const m = new Map<string, string>()
    return {
      get length() {
        return m.size
      },
      clear: () => m.clear(),
      getItem: (k) => m.get(k) ?? null,
      key: (i) => [...m.keys()][i] ?? null,
      removeItem: (k) => void m.delete(k),
      setItem: (k, v) => void m.set(k, v)
    }
  }

  it('updatedNote: first run silent, later version shown once', () => {
    const s = mem()
    expect(updatedNote(s, '0.101.0')).toBeNull()
    expect(s.getItem(SHOWN_KEY)).toBe('0.101.0')
    expect(updatedNote(s, '0.101.0')).toBeNull()
    expect(updatedNote(s, '0.103.2')).toBe('Updated to 0.103.2')
    expect(updatedNote(s, '0.103.2')).toBeNull()
  })
})
