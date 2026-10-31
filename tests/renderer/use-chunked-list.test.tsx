import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChunkedList } from '@/lib/useChunkedList'

const items = Array.from({ length: 500 }, (_, i) => i)

describe('useChunkedList', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gives everything at once with no idle callbacks', () => {
    const { result } = renderHook(() => useChunkedList(items))
    expect(result.current).toBe(items)
  })

  it('gives a first screenful, then the rest in idle steps', () => {
    const idle: (() => void)[] = []
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => idle.push(cb))
    vi.stubGlobal('cancelIdleCallback', () => {})
    const { result } = renderHook(() => useChunkedList(items))
    expect(result.current).toHaveLength(120)
    act(() => idle.at(-1)!())
    expect(result.current).toHaveLength(320)
    act(() => idle.at(-1)!())
    act(() => idle.at(-1)!())
    expect(result.current).toBe(items)
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
