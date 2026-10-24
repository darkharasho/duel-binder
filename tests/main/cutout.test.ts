import { describe, expect, it } from 'vitest'
import { cutOutBackground, type Bitmap } from '../../src/main/images/cutout'

const W = [255, 255, 255, 255]
const R = [200, 0, 0, 255]

/** Rows of pixels → a bitmap. */
const bitmap = (rows: number[][][]): Bitmap => ({
  data: new Uint8Array(rows.flat(2)),
  width: rows[0].length,
  height: rows.length
})
const alpha = (b: Bitmap): number[] => [...b.data].filter((_, i) => i % 4 === 3)

describe('cutOutBackground', () => {
  it('clears white reachable from the edges, keeps enclosed white, and trims', () => {
    const out = cutOutBackground(
      bitmap([
        [W, W, W, W, W],
        [W, R, R, R, W],
        [W, R, W, R, W],
        [W, R, R, R, W],
        [W, W, W, W, W]
      ])
    )!
    expect([out.width, out.height]).toEqual([3, 3])
    expect(alpha(out)).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 255])
  })

  it('reaches white through gaps in the outline', () => {
    const out = cutOutBackground(
      bitmap([
        [W, W, W, W],
        [W, R, W, R],
        [W, R, W, R],
        [W, R, R, R]
      ])
    )!
    expect([out.width, out.height]).toEqual([3, 3])
    expect(alpha(out)).toEqual([255, 0, 255, 255, 0, 255, 255, 255, 255])
  })

  it('trims already-transparent margins and returns null when nothing is left', () => {
    const T = [0, 0, 0, 0]
    expect(cutOutBackground(bitmap([[T, R, T]]))).toMatchObject({ width: 1, height: 1 })
    expect(cutOutBackground(bitmap([[W, T], [T, W]]))).toBeNull()
  })
})
