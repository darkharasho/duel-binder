import { describe, expect, it } from 'vitest'
import {
  shrinkCard,
  tiltFeatures,
  TILT_FEATURES,
  TILT_H,
  TILT_W
} from '../../src/shared/scan/tiltFeatures'
import type { RgbaImage } from '../../src/shared/scan/types'

function solid(width: number, height: number, [r, g, b]: number[]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([r, g, b, 255], i * 4)
  return { width, height, data }
}

/** A seeded generator, so every frame of a run gets the same print. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * A straightened card with a fixed print, textured enough for alignment to find patches: random
 * 8 px checker cells plus noise. `glintOnArtAt` lays a bright diagonal band over the Yu-Gi-Oh!
 * art box at that fraction of the way across it.
 */
function printed({ glintOnArtAt }: { glintOnArtAt?: number } = {}): Uint8Array {
  const rand = seeded(7)
  const cells = Array.from({ length: Math.ceil(TILT_W / 8) * Math.ceil(TILT_H / 8) }, () => [
    40 + rand() * 160,
    40 + rand() * 160,
    40 + rand() * 160
  ])
  const out = new Uint8Array(TILT_W * TILT_H * 3)
  const [ax0, ay0, ax1, ay1] = [0.13 * TILT_W, 0.19 * TILT_H, 0.87 * TILT_W, 0.71 * TILT_H]
  for (let y = 0; y < TILT_H; y++) {
    for (let x = 0; x < TILT_W; x++) {
      const cell = cells[(y >> 3) * Math.ceil(TILT_W / 8) + (x >> 3)]
      let glint = 0
      if (glintOnArtAt != null && x >= ax0 && x < ax1 && y >= ay0 && y < ay1) {
        // Position along the art's diagonal, 0 at its top left and 1 at its bottom right.
        const along = ((x - ax0) / (ax1 - ax0) + (y - ay0) / (ay1 - ay0)) / 2
        if (Math.abs(along - glintOnArtAt) < 0.06) glint = 120
      }
      for (let c = 0; c < 3; c++) {
        out[(y * TILT_W + x) * 3 + c] = Math.min(255, Math.round(cell[c] + rand() * 20 + glint))
      }
    }
  }
  return out
}

describe('tilt features', () => {
  it('lists the 25 features loco3 ranks, in order', () => {
    expect(TILT_FEATURES).toEqual([
      'rxart',
      'rxname',
      'rxtext',
      'rxborder',
      'rxband',
      'rhart',
      'rhname',
      'rhtext',
      'rhborder',
      'rhband',
      'rxEntropy',
      'rxTop',
      'rxGold',
      'rxColour',
      'sp0',
      'sp1',
      'sp2',
      'sp3',
      'spAxis',
      'spSkew',
      'nameHueR',
      'gFlow',
      'artVsText',
      'artVsBorder',
      'textVsBorder'
    ])
  })

  it('shrinks a card by box averaging', () => {
    const out = shrinkCard(solid(842, 1228, [200, 100, 50]))
    expect(out.length).toBe(TILT_W * TILT_H * 3)
    expect([out[0], out[1], out[2]]).toEqual([200, 100, 50])
  })

  it('a card that never moves reflects nothing', () => {
    const r = tiltFeatures(
      Array.from({ length: 6 }, () => printed()),
      'ygo'
    )!
    expect(r.motion).toBe(0)
    expect(r.frames).toBe(6)
    expect(r.features).toHaveLength(TILT_FEATURES.length)
    expect(r.features.slice(0, 10).every((v) => v === 0)).toBe(true)
    expect(r.features.every(Number.isFinite)).toBe(true)
  })

  it('light crossing the art reflects there and not on the text', () => {
    const r = tiltFeatures(
      Array.from({ length: 8 }, (_, t) => printed({ glintOnArtAt: t / 7 })),
      'ygo'
    )!
    const f = (n: string): number => r.features[TILT_FEATURES.indexOf(n)]
    expect(f('rxart')).toBeGreaterThan(f('rxtext'))
    expect(r.motion).toBeGreaterThan(0)
    expect(r.features.every(Number.isFinite)).toBe(true)
  })

  it('needs three frames', () => {
    expect(tiltFeatures([printed(), printed()], 'pkm')).toBeNull()
  })
})
