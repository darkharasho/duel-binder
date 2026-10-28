import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ nativeImage: {} }))

import type { Bitmap } from '../../src/main/images/cutout'
import { findWrappers } from '../../src/main/images/packWrappers'

/**
 * A 100×100 transparent canvas with opaque rectangles on it, like the square pack photos.
 * Each is [x, y, width, height].
 */
const canvas = (...rects: [number, number, number, number][]): Bitmap => {
  const width = 100
  const height = 100
  const data = new Uint8Array(width * height * 4)
  for (const [x0, y0, w, h] of rects)
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) data.set([90, 40, 200, 255], (y * width + x) * 4)
  return { data, width, height }
}

describe('findWrappers', () => {
  it('finds two wrappers side by side', () => {
    expect(findWrappers(canvas([2, 8, 46, 84], [52, 9, 46, 83]))).toEqual({
      width: 100,
      height: 100,
      wrappers: [
        { x: 2, y: 8, width: 46, height: 84 },
        { x: 52, y: 9, width: 46, height: 83 }
      ]
    })
  })

  it('a single wrapper, centred on its canvas, is null', () => {
    expect(findWrappers(canvas([22, 3, 55, 95]))).toBeNull()
  })

  it('a box as wide as two wrappers is null: there is no gap down the middle', () => {
    expect(findWrappers(canvas([2, 8, 96, 84]))).toBeNull()
  })

  it('two boxes, or three wrappers, are null', () => {
    expect(findWrappers(canvas([2, 30, 46, 40], [52, 30, 46, 40]))).toBeNull()
    expect(findWrappers(canvas([1, 20, 31, 56], [34, 20, 31, 56], [67, 20, 31, 56]))).toBeNull()
  })

  it('ignores stray lines and faint shadow', () => {
    const photo = canvas([22, 3, 55, 95], [10, 0, 1, 100], [90, 0, 1, 100])
    expect(findWrappers(photo)).toBeNull()
    const two = canvas([2, 8, 46, 84], [52, 8, 46, 84], [0, 0, 1, 100])
    // A faint shadow bridging the gap doesn't join them.
    for (let x = 48; x < 52; x++) two.data[(95 * 100 + x) * 4 + 3] = 10
    expect(findWrappers(two)?.wrappers).toHaveLength(2)
  })

  it('a photo with no transparency is null', () => {
    expect(findWrappers(canvas([0, 0, 100, 100]))).toBeNull()
  })
})
