import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChunkedList } from '@/lib/useChunkedList'

const items = Array.from({ length: 500 }, (_, i) => i)

/** Stubs idle callbacks; the returned list runs the latest one. */
function stubIdle(): (() => void)[] {
  const idle: (() => void)[] = []
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => idle.push(cb))
  vi.stubGlobal('cancelIdleCallback', () => {})
  return idle
}

/** An element whose bottom edge sits `bottom` px from the top of the window. */
function endAt(bottom: { px: number }): Element {
  const el = document.createElement('ul')
  el.getBoundingClientRect = () => ({ bottom: bottom.px }) as DOMRect
  return el
}

describe('useChunkedList', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gives everything at once with no idle callbacks', () => {
    const { result } = renderHook(() => useChunkedList(items))
    expect(result.current[0]).toBe(items)
  })

  it('gives a first screenful, then the rest in idle steps', () => {
    const idle = stubIdle()
    const { result } = renderHook(() => useChunkedList(items))
    expect(result.current[0]).toHaveLength(120)
    // One idle callback measures, the next grows.
    act(() => idle.at(-1)!())
    act(() => idle.at(-1)!())
    expect(result.current[0]).toHaveLength(320)
    for (let i = 0; i < 4; i++) act(() => idle.at(-1)!())
    expect(result.current[0]).toBe(items)
  })

  it('waits while the list ends far below the window, and grows once a scroll brings it near', () => {
    const idle = stubIdle()
    const bottom = { px: window.innerHeight * 10 }
    const { result, unmount } = renderHook(() => useChunkedList(items))
    act(() => result.current[1](endAt(bottom)))
    act(() => idle.at(-1)!())
    const queued = idle.length
    expect(result.current[0]).toHaveLength(120)
    expect(idle).toHaveLength(queued)

    bottom.px = window.innerHeight * 2
    act(() => document.dispatchEvent(new Event('scroll')))
    act(() => idle.at(-1)!())
    expect(result.current[0]).toHaveLength(320)
    unmount()
  })

  it('stops stepping on unmount', () => {
    const cancel = vi.fn()
    vi.stubGlobal('requestIdleCallback', () => 7)
    vi.stubGlobal('cancelIdleCallback', cancel)
    const { unmount } = renderHook(() => useChunkedList(items))
    unmount()
    expect(cancel).toHaveBeenCalledWith(7)
  })
})
