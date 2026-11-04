import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefetchArt, resetArtPrefetch, useArtPrefetch } from '@/lib/artPrefetch'

/** Records each Image's src; `finish()` settles the oldest one still loading. */
let started: string[] = []
let loading: { onload: (() => void) | null }[] = []
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  decoding = 'auto'
  set src(v: string) {
    started.push(v)
    loading.push(this)
  }
}
const finish = (): void => loading.shift()?.onload?.()

beforeEach(() => {
  started = []
  loading = []
  resetArtPrefetch()
  vi.stubGlobal('Image', FakeImage)
})
afterEach(() => vi.unstubAllGlobals())

describe('art prefetch', () => {
  it('fetches in order, six at a time, each art once', () => {
    const srcs = Array.from({ length: 8 }, (_, i) => `ygo-img://small/${i + 1}`)
    prefetchArt(srcs)
    expect(started).toEqual(srcs.slice(0, 6))
    finish()
    expect(started).toEqual(srcs.slice(0, 7))
    prefetchArt(srcs) // the page again: nothing already fetched is asked twice
    while (loading.length) finish()
    expect(started).toEqual(srcs)
  })

  it('a new page replaces what was still waiting', () => {
    prefetchArt(Array.from({ length: 10 }, (_, i) => `ygo-img://small/${i + 1}`))
    prefetchArt(['ygo-img://small/99'])
    while (loading.length) finish()
    expect(started).toEqual([
      ...Array.from({ length: 6 }, (_, i) => `ygo-img://small/${i + 1}`),
      'ygo-img://small/99'
    ])
  })

  it("a set's tiles, card art then the printing's photo, once the page is idle", async () => {
    vi.useFakeTimers()
    try {
      const tiles = [{ imageId: 5, printingId: 12 }, { imageId: 6 }]
      renderHook(() => useArtPrefetch(tiles))
      expect(started).toEqual([])
      await vi.runAllTimersAsync()
      expect(started).toEqual(['ygo-img://small/5', 'ygo-img://printing/12', 'ygo-img://small/6'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaving the page drops what had not started', async () => {
    vi.useFakeTimers()
    try {
      const tiles = Array.from({ length: 10 }, (_, i) => ({ imageId: i + 1 }))
      const page = renderHook(() => useArtPrefetch(tiles))
      await vi.runAllTimersAsync()
      page.unmount()
      while (loading.length) finish()
      expect(started).toHaveLength(6)
    } finally {
      vi.useRealTimers()
    }
  })
})
