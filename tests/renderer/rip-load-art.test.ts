import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadArt } from '@/features/rip/loadArt'

/** An Image stand-in that loads (or fails, for "bad" srcs) when told to. */
const images: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = []
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  constructor() {
    images.push(this)
  }
}

afterEach(() => {
  images.length = 0
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('loadArt', () => {
  it('resolves once every image has loaded or failed', async () => {
    vi.stubGlobal('Image', FakeImage)
    let done = false
    const p = loadArt(['a', 'b'], 10_000).then(() => (done = true))
    expect(images.map((i) => i.src)).toEqual(['a', 'b'])
    images[0].onload!()
    await Promise.resolve()
    expect(done).toBe(false)
    images[1].onerror!()
    await p
    expect(done).toBe(true)
  })

  it('gives up waiting after the timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Image', FakeImage)
    let done = false
    void loadArt(['a'], 8000).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(7999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })
})
