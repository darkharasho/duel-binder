import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReplayScene } from '@/features/scan/replay/draw'
import { replayTimeline } from '@/features/scan/replay/timeline'
import { recordingContext } from './replayCanvas'

const sizes: number[] = []
const frames: { w: number; h: number }[][] = []
vi.mock('gifenc', () => ({
  GIFEncoder: () => {
    const mine: { w: number; h: number }[] = []
    frames.push(mine)
    return {
      writeFrame: (_i: Uint8Array, w: number, h: number) => mine.push({ w, h }),
      finish: () => {},
      bytes: () => new Uint8Array(sizes.shift() ?? 1)
    }
  },
  quantize: () => [[0, 0, 0]],
  applyPalette: (rgba: Uint8ClampedArray) => new Uint8Array(rgba.length / 4)
}))

const { encodeGif, pickVideoType, MAX_BYTES } = await import('@/features/scan/replay/encode')

const scene: ReplayScene = {
  pulls: [
    {
      key: 'a',
      name: 'A',
      imageId: 1,
      photoId: null,
      rarity: null,
      setCode: null,
      price: 2,
      quantity: 1,
      addedAt: 1
    }
  ],
  art: [{} as ImageBitmap],
  header: 'h',
  timeline: replayTimeline(1)
}

describe('pickVideoType', () => {
  it('prefers mp4 avc1', () => {
    expect(pickVideoType(() => true)).toEqual({ mime: 'video/mp4;codecs=avc1', ext: 'mp4' })
  })

  it('falls back to webm', () => {
    expect(pickVideoType((m) => m.startsWith('video/webm'))?.ext).toBe('webm')
  })

  it('null without MediaRecorder', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(pickVideoType()).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('encodeGif', () => {
  beforeEach(() => {
    sizes.length = 0
    frames.length = 0
    // jsdom has no canvas: hand out recording contexts with fake pixels.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      const { ctx } = recordingContext()
      const { width, height } = this
      ;(ctx as unknown as Record<string, unknown>).getImageData = () => ({
        data: new Uint8ClampedArray(width * height * 4)
      })
      return ctx as never
    } as never)
  })
  afterEach(() => vi.restoreAllMocks())

  it('steps down when too big', async () => {
    sizes.push(MAX_BYTES + 1, 1000)
    const blob = await encodeGif(scene, { signal: new AbortController().signal })
    expect(blob.size).toBe(1000)
    expect(blob.type).toBe('image/gif')
    expect(frames[1][0]).toEqual({ w: 288, h: 360 })
  })

  it('gives up past the last step', async () => {
    sizes.push(MAX_BYTES + 1, MAX_BYTES + 1, MAX_BYTES + 1)
    await expect(encodeGif(scene, { signal: new AbortController().signal })).rejects.toThrow(
      /too big/
    )
  })

  it('abort stops the GIF', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(encodeGif(scene, { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})

describe('recordVideo', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // A hidden page stops drawing while the clock runs on: the video would freeze, so it stops.
  it('stops with a message when the page is hidden mid-recording', async () => {
    const { recordVideo } = await import('@/features/scan/replay/encode')
    class FakeRecorder {
      state = 'inactive'
      ondataavailable: ((e: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null
      start(): void {
        this.state = 'recording'
      }
      stop(): void {
        this.state = 'inactive'
        this.onstop?.()
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recordingContext().ctx as never
    )
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      value: () => ({ getTracks: () => [] })
    })
    const done = recordVideo(
      scene,
      { mime: 'video/mp4', ext: 'mp4' },
      {
        signal: new AbortController().signal
      }
    )
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await expect(done).rejects.toThrow('Keep Duel Binder open while the replay records')
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })
})
