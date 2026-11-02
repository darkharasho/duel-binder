import { describe, expect, it } from 'vitest'
import { createTiltFrames } from '../../src/renderer/src/features/scan/vision/tiltFrames'
import { TILT_H, TILT_W } from '../../src/shared/scan/tiltFeatures'
import type { RgbaImage } from '../../src/shared/scan/types'

function solid(width: number, height: number, [r, g, b]: number[]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([r, g, b, 255], i * 4)
  return { width, height, data }
}

describe('createTiltFrames', () => {
  it('keeps the latest frames up to its cap, oldest first', () => {
    const f = createTiltFrames(3)
    for (let t = 0; t < 5; t++) f.keep(solid(842, 1228, [t, t, t]), t * 100)
    expect(f.size).toBe(3)
    expect(f.latest(1000, 400).map((x) => x[0])).toEqual([2, 3, 4])
  })

  it('reads only the window asked for', () => {
    const f = createTiltFrames(10)
    for (let t = 0; t < 5; t++) f.keep(solid(842, 1228, [t, t, t]), t * 100)
    expect(f.latest(250, 400).map((x) => x[0])).toEqual([2, 3, 4])
    f.clear()
    expect(f.size).toBe(0)
  })

  it('keeps each card shrunk to the tilt working size, as RGB', () => {
    const f = createTiltFrames()
    f.keep(solid(842, 1228, [9, 8, 7]), 0)
    const [rgb] = f.latest(1000, 0)
    expect(rgb.length).toBe(TILT_W * TILT_H * 3)
    expect([...rgb.subarray(0, 3)]).toEqual([9, 8, 7])
  })
})
