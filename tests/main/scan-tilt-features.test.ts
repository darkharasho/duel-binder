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

type Box = readonly [number, number, number, number]
const YGO_ART: Box = [0.13, 0.19, 0.87, 0.71]
const PKM_ART: Box = [0.1, 0.14, 0.9, 0.47]
/** A Pokémon card's body under the art, where a reverse holo's foil sits. */
const PKM_BODY: Box = [0.09, 0.53, 0.91, 0.88]

/**
 * A straightened card with a fixed print, textured enough for alignment to find patches: random
 * 8 px checker cells plus noise. `glintOnArtAt` lays a bright diagonal band over `on` (the
 * Yu-Gi-Oh! art box unless given) at that fraction of the way across it; `flash` lights all of
 * `on` by that much, as a reverse holo's body does at the right angle.
 */
function printed({
  glintOnArtAt,
  flash = 0,
  on = YGO_ART
}: { glintOnArtAt?: number; flash?: number; on?: Box } = {}): Uint8Array {
  const rand = seeded(7)
  const cells = Array.from({ length: Math.ceil(TILT_W / 8) * Math.ceil(TILT_H / 8) }, () => [
    40 + rand() * 160,
    40 + rand() * 160,
    40 + rand() * 160
  ])
  const out = new Uint8Array(TILT_W * TILT_H * 3)
  const [ax0, ay0, ax1, ay1] = [on[0] * TILT_W, on[1] * TILT_H, on[2] * TILT_W, on[3] * TILT_H]
  for (let y = 0; y < TILT_H; y++) {
    for (let x = 0; x < TILT_W; x++) {
      const cell = cells[(y >> 3) * Math.ceil(TILT_W / 8) + (x >> 3)]
      const inside = x >= ax0 && x < ax1 && y >= ay0 && y < ay1
      let glint = inside ? flash : 0
      if (glintOnArtAt != null && inside) {
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
  it('lists the 25 features the tilt model is fitted on, in its fixed order', () => {
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

  it('reads a Pokémon card at its own art and body', () => {
    const run = (frame: (t: number) => Uint8Array): ((n: string) => number) => {
      const r = tiltFeatures(
        Array.from({ length: 6 }, (_, t) => frame(t)),
        'pkm'
      )!
      expect(r.features.every(Number.isFinite)).toBe(true)
      return (n) => r.features[TILT_FEATURES.indexOf(n)]
    }
    const art = run((t) => printed({ glintOnArtAt: t / 5, on: PKM_ART }))
    expect(art('rxart')).toBeGreaterThan(10 * art('rxtext'))
    // The body lit in every other frame. The Yu-Gi-Oh! art box would reach into it, and its
    // exposure cells (the text box) would sit in it and cancel the light; the Pokémon ones read
    // the outer border.
    const body = run((t) => printed({ flash: t % 2 ? 60 : 0, on: PKM_BODY }))
    expect(body('rxtext')).toBeGreaterThan(10 * body('rxart'))
    expect(body('rxtext')).toBeGreaterThan(20)
  })

  it('needs three frames', () => {
    expect(tiltFeatures([printed(), printed()], 'pkm')).toBeNull()
  })

  it('refuses a frame of another size', () => {
    const frames = [printed(), printed(), new Uint8Array(100 * 100 * 3)]
    expect(() => tiltFeatures(frames, 'ygo')).toThrow(/frame 2/)
    expect(() => tiltFeatures([new Uint8Array(3)], 'pkm')).toThrow()
  })
})
