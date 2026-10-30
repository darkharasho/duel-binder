import { describe, expect, it } from 'vitest'
import { toInkBlock } from '../../src/renderer/src/features/scan/vision/bands'
import type { RgbaImage } from '../../src/shared/scan/types'

/** A 200x60 box shading from light to mid grey, with a 2px dark stroke across it at y 30. */
function shadedLine(): RgbaImage {
  const width = 200
  const height = 60
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = y === 30 || y === 31 ? 90 : 230 - Math.round((x / width) * 90)
      data.set([v, v, v, 255], (y * width + x) * 4)
    }
  return { width, height, data }
}

describe('toInkBlock', () => {
  it('draws the ink black on white at twice the size, whatever the shading behind it', () => {
    const band = toInkBlock(shadedLine(), [0, 0, 1, 1])
    expect([band.width, band.height]).toEqual([400, 120])
    expect(new Set(band.data)).toEqual(new Set([0, 255]))
    // The stroke, at either end of the shading, and the box around it.
    expect(band.data[61 * 400 + 10]).toBe(0)
    expect(band.data[61 * 400 + 390]).toBe(0)
    expect(band.data[20 * 400 + 10]).toBe(255)
    expect(band.data[100 * 400 + 390]).toBe(255)
  })
})
