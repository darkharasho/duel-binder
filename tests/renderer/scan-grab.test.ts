import { afterEach, describe, expect, it, vi } from 'vitest'
import { grab } from '@/features/scan/useScanLoop'

// The phone's 4K camera frames come shrunk to maxWidth, the quad's frame size with them.

const video = (videoWidth: number, videoHeight: number): HTMLVideoElement =>
  ({ videoWidth, videoHeight }) as HTMLVideoElement

const bitmap = (width: number, height: number): ImageBitmap =>
  ({ width, height, close: vi.fn() }) as unknown as ImageBitmap

afterEach(() => vi.unstubAllGlobals())

describe('grab', () => {
  it("shrinks a crop wider than maxWidth to it, through the browser's resize", async () => {
    const made = vi.fn(
      async (_v: unknown, _x: number, _y: number, w: number, h: number, o?: ImageBitmapOptions) =>
        bitmap(o?.resizeWidth ?? w, o?.resizeHeight ?? h)
    )
    vi.stubGlobal('createImageBitmap', made)
    const got = await grab(video(2160, 3840), false, 1080)
    // A 3:4 crop of a portrait 4K frame is 2160x2880.
    expect(made).toHaveBeenCalledWith(expect.anything(), 0, 480, 2160, 2880, {
      resizeWidth: 1080,
      resizeHeight: 1440,
      resizeQuality: 'medium'
    })
    expect(got).toMatchObject({ width: 1080, height: 1440 })
  })

  it('leaves a crop no wider than maxWidth as it is', async () => {
    const made = vi.fn(async (_v: unknown, _x: number, _y: number, w: number, h: number) =>
      bitmap(w, h)
    )
    vi.stubGlobal('createImageBitmap', made)
    const got = await grab(video(640, 480), false, 1080)
    expect(made).toHaveBeenCalledWith(expect.anything(), 140, 0, 360, 480)
    expect(got).toMatchObject({ width: 360, height: 480 })
  })

  it('draws the frame smaller when the browser ignores the resize', async () => {
    const full = bitmap(2160, 2880)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => full)
    )
    const drawImage = vi.fn()
    class FakeCanvas {
      constructor(
        public width: number,
        public height: number
      ) {}
      getContext(): object {
        return { drawImage }
      }
      transferToImageBitmap(): ImageBitmap {
        return bitmap(this.width, this.height)
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    const got = await grab(video(2160, 3840), false, 1080)
    expect(full.close).toHaveBeenCalled()
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 480, 2160, 2880, 0, 0, 1080, 1440)
    expect(got).toMatchObject({ width: 1080, height: 1440 })
  })

  it('shrinks the whole frame by the crop’s scale, with the crop as its region', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        async (_v: unknown, _x: number, _y: number, w: number, h: number, o?: ImageBitmapOptions) =>
          bitmap(o?.resizeWidth ?? w, o?.resizeHeight ?? h)
      )
    )
    const got = await grab(video(3840, 2160), true, 810)
    // The 3:4 crop of landscape 4K is 1620x2160 at x 1110: halved.
    expect(got?.frame.width).toBe(1920)
    expect(got?.region).toEqual({ x: 555, y: 0, width: 810, height: 1080 })
    expect(got).toMatchObject({ width: 810, height: 1080 })
  })
})
