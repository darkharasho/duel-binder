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

// Each Output records its source's config, the timestamps it was given, and comes out `outSizes`.
const outputs: { bitrate: number; hardware?: string; stamps: number[] }[] = []
// Whether this "device" has a hardware H.264 encoder.
const device = { hardware: false }
const outSizes: number[] = []
vi.mock('mediabunny', () => {
  class CanvasSource {
    stamps: number[] = []
    constructor(
      _c: unknown,
      public config: { bitrate: number; hardwareAcceleration?: string }
    ) {}
    async add(t: number): Promise<void> {
      this.stamps.push(t)
    }
  }
  class BufferTarget {
    buffer: ArrayBuffer | null = null
  }
  class Output {
    source: CanvasSource | null = null
    constructor(public opts: { target: BufferTarget }) {}
    addVideoTrack(source: CanvasSource): void {
      this.source = source
      outputs.push({
        bitrate: source.config.bitrate,
        hardware: source.config.hardwareAcceleration,
        stamps: source.stamps
      })
    }
    start = (): Promise<void> => Promise.resolve()
    async finalize(): Promise<void> {
      this.opts.target.buffer = new ArrayBuffer(outSizes.shift() ?? 1)
    }
    cancel = (): Promise<void> => Promise.resolve()
  }
  return {
    CanvasSource,
    BufferTarget,
    Output,
    Mp4OutputFormat: class {},
    canEncodeVideo: async (_codec: string, o?: { hardwareAcceleration?: string }) =>
      o?.hardwareAcceleration === 'prefer-hardware' ? device.hardware : true
  }
})

// Which backdrop each drawn frame asked for.
const drawnBackdrops: (string | undefined)[] = []
vi.mock('@/features/scan/replay/draw', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/scan/replay/draw')>()
  return {
    ...real,
    drawReplayFrame: (...args: Parameters<typeof real.drawReplayFrame>) => {
      drawnBackdrops.push(args[1].backdrop)
      real.drawReplayFrame(...args)
    }
  }
})

const { encodeGif, pickVideoType, MAX_BYTES, videoBitrate, canEncodeFrames, encodeVideoFrames } =
  await import('@/features/scan/replay/encode')

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

  it('always draws the deep backdrop: GIF has no blocks to fear', async () => {
    drawnBackdrops.length = 0
    await encodeGif(scene, { signal: new AbortController().signal })
    expect(new Set(drawnBackdrops)).toEqual(new Set(['deep']))
  })

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

describe('videoBitrate', () => {
  it('fills under the size limit over a long replay', () => {
    const b = videoBitrate(30_000)
    expect((b / 8) * 30).toBeLessThan(MAX_BYTES)
    expect(b).toBeGreaterThan(2_000_000)
  })

  it('caps a short replay', () => {
    expect(videoBitrate(7_500)).toBe(8_000_000)
  })
})

describe('canEncodeFrames', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('false without WebCodecs', async () => {
    vi.stubGlobal('VideoEncoder', undefined)
    expect(await canEncodeFrames()).toBe(false)
  })

  it('asks mediabunny where WebCodecs exists', async () => {
    vi.stubGlobal('VideoEncoder', class {})
    expect(await canEncodeFrames()).toBe(true)
  })
})

describe('encodeVideoFrames', () => {
  beforeEach(() => {
    outputs.length = 0
    outSizes.length = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recordingContext().ctx as never
    )
  })
  afterEach(() => vi.restoreAllMocks())

  it('encodes every frame at 30 fps, evenly stamped', async () => {
    const blob = await encodeVideoFrames(scene, { signal: new AbortController().signal })
    expect(blob.type).toBe('video/mp4')
    const { stamps } = outputs[0]
    expect(stamps).toHaveLength(Math.ceil((scene.timeline.duration / 1000) * 30))
    expect(stamps[1] - stamps[0]).toBeCloseTo(1 / 30)
  })

  it('tries once more at a lower bitrate when over the limit', async () => {
    outSizes.push(MAX_BYTES + 1, 1000)
    const blob = await encodeVideoFrames(scene, { signal: new AbortController().signal })
    expect(blob.size).toBe(1000)
    expect(outputs).toHaveLength(2)
    expect(outputs[1].bitrate).toBeLessThan(outputs[0].bitrate)
  })

  it('gives up when both come out too big', async () => {
    outSizes.push(MAX_BYTES + 1, MAX_BYTES + 1)
    await expect(
      encodeVideoFrames(scene, { signal: new AbortController().signal })
    ).rejects.toThrow('The video came out too big')
  })

  // Software H.264 blocks the deep backdrop's soft dark gradients; it gets the bright one.
  describe('backdrop', () => {
    beforeEach(() => {
      drawnBackdrops.length = 0
      vi.stubGlobal('VideoEncoder', class {})
    })
    afterEach(() => {
      device.hardware = false
      vi.unstubAllGlobals()
    })

    it('with a hardware encoder: deep, on the hardware encoder', async () => {
      device.hardware = true
      await encodeVideoFrames(scene, { signal: new AbortController().signal })
      expect(outputs[0].hardware).toBe('prefer-hardware')
      expect(new Set(drawnBackdrops)).toEqual(new Set(['deep']))
    })

    it('software only: bright', async () => {
      await encodeVideoFrames(scene, { signal: new AbortController().signal })
      expect(outputs[0].hardware).not.toBe('prefer-hardware')
      expect(new Set(drawnBackdrops)).toEqual(new Set(['bright']))
    })
  })

  it('stops when cancelled', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(encodeVideoFrames(scene, { signal: ac.signal })).rejects.toThrow(
      'The replay was stopped'
    )
  })
})
