// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { scanProfile } from '../../src/shared/scan/profiles'
import type { RgbaImage } from '../../src/shared/scan/types'
import {
  analyze,
  bandWidth,
  cutCodeBands
} from '../../src/renderer/src/features/scan/vision/analyze'
import { toBand } from '../../src/renderer/src/features/scan/vision/bands'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import { rotate180, warpCard, type Quad } from '../../src/renderer/src/features/scan/vision/detect'

// Hand vitest the plain OpenCV module (see scan-vision-detect.test.ts).
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

let cv: CV
beforeAll(async () => {
  cv = await loadCv()
})

/** A dark desk with a light card in QUAD and dark ink: a line inside it, and marks just below it. */
const QUAD: Quad = [
  [100, 100],
  [400, 100],
  [400, 520],
  [100, 520]
]
function frame(): RgbaImage {
  const width = 600
  const height = 800
  const data = new Uint8ClampedArray(width * height * 4)
  const set = (x: number, y: number, v: number): void =>
    data.set([v, v, v, 255], (y * width + x) * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, 40)
  // The card, and a light strip below it where the number sits on an outline that ends short.
  for (let y = 100; y < 548; y++) for (let x = 100; x < 400; x++) set(x, y, 235)
  // Marks below the outline (frame y 527-538, x 325-385), like a number's characters.
  for (let y = 527; y < 539; y++)
    for (let x = 325; x < 386; x++) if ((x - 325) % 8 < 5) set(x, y, 20)
  // A line of text inside the card, near its foot, for the bands with no reach.
  for (let y = 495; y < 505; y++)
    for (let x = 140; x < 380; x++) if ((x - 140) % 9 < 5) set(x, y, 20)
  return { width, height, data }
}

describe('code bands past the outline (codeReach)', () => {
  it("an op frame's second band holds what is printed below the outline", () => {
    const img = frame()
    const op = scanProfile('op')
    const straight = warpCard(cv, img, QUAD, bandWidth(QUAD))
    const bands = cutCodeBands(cv, img, QUAD, op, [straight, rotate180(straight)], null)
    // Each band, either way up.
    expect(bands).toHaveLength(4)
    const [main, low] = bands
    // The second band spans 0.975-1.05 of the card: three times the 0.025 left inside it.
    const ratio = (b: { height: number }): number => b.height / main.height
    expect(ratio(low)).toBeCloseTo((1.05 - 0.975) / (0.98 - 0.934), 1)
    // Its top rows are the card inside the outline (light), its lower half has the dark marks.
    const row = (y: number): number[] =>
      Array.from(low.data.subarray(y * low.width, (y + 1) * low.width))
    expect(Math.min(...row(1))).toBeGreaterThan(150)
    const lower = Array.from({ length: Math.floor(low.height / 2) }, (_, i) =>
      Math.min(...row(low.height - 1 - i))
    )
    expect(Math.min(...lower)).toBeLessThan(60)
  })

  it('ygo and pkm code bands are cut as before: off the straightened card, as ink', () => {
    const img = frame()
    for (const game of ['ygo', 'pkm'] as const) {
      const profile = scanProfile(game)
      expect(profile.codeReach).toBeUndefined()
      const straight = warpCard(cv, img, QUAD, bandWidth(QUAD))
      const ways = [straight, rotate180(straight)]
      const before = ways
        .flatMap((c) => profile.codeBands.map((box) => toBand(c, box)))
        .filter((b) => b.width > 0)
      expect(cutCodeBands(cv, img, QUAD, profile, ways, null)).toEqual(before)

      // And analyze's, off whatever outline it finds.
      const signals = analyze(cv, img, null, null, true, false, profile)
      expect(signals.quad).not.toBeNull()
      const card = warpCard(cv, img, signals.quad!, bandWidth(signals.quad!))
      const found = [card, rotate180(card)]
      expect(signals.codeBands).toEqual(
        found
          .flatMap((c) => profile.codeBands.map((box) => toBand(c, box)))
          .filter((b) => b.width > 0)
      )
      expect(signals.nameBands).toEqual(
        found.map((c) => toBand(c, profile.nameBand)).filter((b) => b.width > 0)
      )
    }
  })

  it("analyze cuts an op frame's code bands the same way", () => {
    const img = frame()
    const op = scanProfile('op')
    const signals = analyze(cv, img, null, null, true, false, op)
    const q = signals.quad!
    const straight = warpCard(cv, img, q, bandWidth(q))
    expect(signals.codeBands).toEqual(
      cutCodeBands(cv, img, q, op, [straight, rotate180(straight)], null)
    )
  })
})
