import { decode, encode } from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { jpegSize, upright, uprightJpeg } from '../../src/shared/upright'

/** A w×h JPEG whose left half is red and right half blue. */
function halves(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      data.set(x < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * w + x) * 4)
  return new Uint8Array(encode({ width: w, height: h, data }, 95).data)
}

const pixel = (bytes: Uint8Array, x: number, y: number): number[] => {
  const img = decode(bytes, { useTArray: true, formatAsRGBA: true })
  const i = (y * img.width + x) * 4
  return [...img.data.subarray(i, i + 3)]
}

describe('upright', () => {
  it('turns a landscape image a quarter counter-clockwise', () => {
    // 3×2: a b c / d e f  →  2×3: c f / b e / a d
    const px = (v: number): number[] => [v, 0, 0, 255]
    const data = new Uint8Array([1, 2, 3, 4, 5, 6].flatMap(px))
    const out = upright({ width: 3, height: 2, data })
    expect([out.width, out.height]).toEqual([2, 3])
    expect([...out.data].filter((_, i) => i % 4 === 0)).toEqual([3, 6, 2, 5, 1, 4])
  })
})

describe('jpegSize', () => {
  it('reads the frame header', () => {
    expect(jpegSize(halves(42, 30))).toEqual({ width: 42, height: 30 })
  })
  it('is null for anything that is not a JPEG', () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toBeNull()
  })
})

describe('uprightJpeg', () => {
  it('stands a landscape JPEG upright: its left half ends up at the bottom', () => {
    const out = uprightJpeg(halves(42, 30))!
    expect(jpegSize(out)).toEqual({ width: 30, height: 42 })
    const [top, bottom] = [pixel(out, 12, 5), pixel(out, 12, 34)]
    expect(top[2]).toBeGreaterThan(200) // blue: the right half
    expect(bottom[0]).toBeGreaterThan(200) // red: the left half
  })

  it('leaves portrait, unreadable and wider-than-a-card images alone', () => {
    expect(uprightJpeg(halves(30, 42))).toBeNull()
    expect(uprightJpeg(halves(100, 57))).toBeNull() // TCGplayer's "Image Coming Soon" shape
    expect(uprightJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toBeNull()
  })

  it('works without a global Buffer, as in a Worker', () => {
    const input = halves(42, 30)
    const g = globalThis as { Buffer?: unknown }
    const saved = g.Buffer
    delete g.Buffer
    try {
      const out = uprightJpeg(input)
      expect(out && jpegSize(out)).toEqual({ width: 30, height: 42 })
      expect(g.Buffer).toBeUndefined()
    } finally {
      g.Buffer = saved
    }
  })
})
