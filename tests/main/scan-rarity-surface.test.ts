import { describe, expect, it } from 'vitest'
import {
  SURFACE_FOIL_MIN,
  SURFACE_PLAIN_MAX,
  surfaceLook,
  surfaceOver,
  surfaceScore,
  type SurfaceReading
} from '../../src/shared/scan/surface'
import type { RgbaImage } from '../../src/shared/scan/types'
import {
  FRAME_STRIPS,
  surface,
  TEXT_AREA,
  texture
} from '../../src/renderer/src/features/scan/vision/foil'

// Synthetic straightened cards: an orange frame, a cream text box with crisp black print, and
// frame strips that are flat card stock or covered in glitter.
const W = 842
const H = 1228

/** A seeded PRNG, so the glitter is the same every run. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0
    return a / 4294967296
  }
}

function card(opts: { glitter?: number; grain?: number; seed?: number } = {}): RgbaImage {
  const random = rng(opts.seed ?? 1)
  const data = new Uint8ClampedArray(W * H * 4)
  const inside = (x: number, y: number, [x0, y0, x1, y1]: readonly number[]): boolean =>
    x >= x0 * W && x < x1 * W && y >= y0 * H && y < y1 * H
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let rgb = [200, 110, 60]
      if (inside(x, y, TEXT_AREA)) {
        rgb = [225, 215, 190]
        // Rows of letters: 3 px strokes every 9 px, in lines 14 px apart.
        if (y % 14 < 9 && x % 9 < 3) rgb = [30, 25, 20]
      }
      const grain = (random() - 0.5) * 2 * (opts.grain ?? 2)
      // Glitter: bright 2x2 sparkles, scattered over the whole card.
      const block = Math.floor(x / 2) * 7919 + Math.floor(y / 2) * 104729
      const sparkle = opts.glitter && (block % 1000) / 1000 < opts.glitter ? 90 : 0
      const p = (y * W + x) * 4
      for (let c = 0; c < 3; c++) data[p + c] = rgb[c] + grain + sparkle
      data[p + 3] = 255
    }
  return { width: W, height: H, data }
}

describe('texture', () => {
  it('reads flat card stock as smooth and print as sharp', () => {
    const plain = card()
    const strip = texture(plain, FRAME_STRIPS[0])
    const text = texture(plain, TEXT_AREA)
    expect(strip.floor).toBeLessThan(1.5)
    expect(strip.edges).toBeLessThan(4)
    expect(text.edges).toBeGreaterThan(30)
  })

  it('reads glitter as fine and coarse texture', () => {
    const plain = texture(card(), FRAME_STRIPS[0])
    const foil = texture(card({ glitter: 0.15 }), FRAME_STRIPS[0])
    expect(foil.fine).toBeGreaterThan(3 * plain.fine)
    expect(foil.coarse).toBeGreaterThan(3 * plain.coarse)
  })
})

describe('surface', () => {
  it('tells a card foil all over from one with a plain frame', () => {
    const plain = surface(card())
    const foil = surface(card({ glitter: 0.15 }))
    expect(surfaceScore(plain, 'effect')).toBeLessThanOrEqual(SURFACE_PLAIN_MAX)
    expect(surfaceScore(foil, 'effect')).toBeGreaterThanOrEqual(SURFACE_FOIL_MIN)
    expect(surfaceLook(plain, 'effect')).toBe('plain')
    expect(surfaceLook(foil, 'effect')).toBe('foil')
  })

  it('takes the frame texture against how sharp the print is', () => {
    // The same grain on a softer shot (blunter print) scores higher.
    const sharp = surface(card({ grain: 6 }))
    const soft: SurfaceReading = {
      ...sharp,
      textEdges: sharp.textEdges / 3,
      textFine: sharp.textFine / 3
    }
    expect(surfaceScore(soft, 'effect')).toBeGreaterThan(surfaceScore(sharp, 'effect'))
  })
})

describe('surfaceLook', () => {
  const plain = surface(card())
  const foil = surface(card({ glitter: 0.15 }))

  it('reads nothing on a Pendulum frame, whose artwork covers the strips', () => {
    expect(surfaceLook(plain, 'effect_pendulum')).toBeNull()
    expect(surfaceLook(foil, 'normal_pendulum')).toBeNull()
    expect(surfaceLook(null, 'effect')).toBeNull()
  })

  it('never reads a Link frame as foil, nor an Xyz frame as plain', () => {
    expect(surfaceLook(foil, 'link')).toBeNull()
    expect(surfaceLook(plain, 'link')).toBe('plain')
    expect(surfaceLook(plain, 'xyz')).toBeNull()
    expect(surfaceLook(foil, 'xyz')).toBe('foil')
  })

  it('reads nothing in between', () => {
    const between = surface(card({ glitter: 0.06, grain: 4 }))
    const score = surfaceScore(between, 'effect')
    expect(score).toBeGreaterThan(SURFACE_PLAIN_MAX)
    expect(score).toBeLessThan(SURFACE_FOIL_MIN)
    expect(surfaceLook(between, 'effect')).toBeNull()
  })
})

describe('surfaceOver', () => {
  const r = (v: number): SurfaceReading => ({
    frameFloor: v,
    frameCoarse: 2 * v,
    textEdges: 10 * v,
    textFine: 3 * v
  })

  it('takes the median of each measurement', () => {
    expect(surfaceOver([])).toBeNull()
    expect(surfaceOver([r(1), r(5), r(2)])).toEqual(r(2))
    expect(surfaceOver([r(1), r(3)])).toEqual(r(2))
  })
})
