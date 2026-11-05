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
    { key: 'a', name: 'A', imageId: 1, photoId: null, rarity: null, setCode: null, price: 2, quantity: 1, addedAt: 1 }
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
      const canvas = this
      ;(ctx as unknown as Record<string, unknown>).getImageData = () => ({
        data: new Uint8ClampedArray(canvas.width * canvas.height * 4)
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
