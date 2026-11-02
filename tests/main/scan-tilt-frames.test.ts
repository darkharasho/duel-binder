import { describe, expect, it } from 'vitest'
import {
  createTiltFrames,
  keepsForTilt,
  keepsOutline
} from '../../src/renderer/src/features/scan/vision/tiltFrames'
import { scanProfile } from '../../src/shared/scan/profiles'
import { ART_MAX_DISTANCE, TILT_MAX_ART_DISTANCE } from '../../src/shared/scan/thresholds'
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

  it('places frames by when they were captured, however late they were kept', () => {
    const f = createTiltFrames()
    // Captured at 0-400 ms, but kept in a burst after waiting behind a reading.
    for (let t = 0; t < 5; t++) f.keep(solid(842, 1228, [t, t, t]), t * 100)
    expect(f.latest(250, 400).map((x) => x[0])).toEqual([2, 3, 4])
    // A reading asked for at 200 ms leaves out frames captured after it.
    expect(f.latest(250, 200).map((x) => x[0])).toEqual([0, 1, 2])
  })
})

describe('keepsForTilt', () => {
  it("keeps a held card's art, glare and all, but not a far match or another card", () => {
    expect(TILT_MAX_ART_DISTANCE).toBe(ART_MAX_DISTANCE * 1.5)
    const at = (imageId: number, distance: number): { imageId: number; distance: number } => ({
      imageId,
      distance
    })
    expect(keepsForTilt([at(7, 20)], [7, 8])).toBe(true)
    // Glare past a match's distance is still the held card.
    expect(keepsForTilt([at(8, ART_MAX_DISTANCE + 20)], [7, 8])).toBe(true)
    expect(keepsForTilt([at(7, TILT_MAX_ART_DISTANCE)], [7])).toBe(true)
    // A hand or a bad outline over it.
    expect(keepsForTilt([at(7, TILT_MAX_ART_DISTANCE + 1)], [7])).toBe(false)
    expect(keepsForTilt([at(9, 10), at(7, 12)], [7])).toBe(false)
    expect(keepsForTilt([], [7])).toBe(false)
  })
})

describe('keepsOutline', () => {
  it("stays on a Yu-Gi-Oh card's outline only while it's tilted, and on a Pokémon card's always", () => {
    expect(keepsOutline(scanProfile('ygo'), true)).toBe(true)
    // A live Yu-Gi-Oh frame searches every time, as before tilts.
    expect(keepsOutline(scanProfile('ygo'), false)).toBe(false)
    expect(keepsOutline(scanProfile('pkm'), true)).toBe(true)
    expect(keepsOutline(scanProfile('pkm'), false)).toBe(true)
  })
})
