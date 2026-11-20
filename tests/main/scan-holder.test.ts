// @vitest-environment node
// Graded-slab detection on synthetic frames: the fixture shots bare, in a toploader-like case
// (tests/main/scanCase.ts), and with a label block drawn above the card inside a wider outline:
// white paper (PSA, BGS, CGC...) or TAG's clear label, a thin white frame with white print.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { RgbaImage } from '../../src/shared/scan/types'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import { toMat, using, type Quad } from '../../src/renderer/src/features/scan/vision/detect'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { scanProfile } from '../../src/shared/scan/profiles'
import { isSlab, slabQuad } from '../../src/renderer/src/features/scan/vision/holder'
import { inCase, TIGHT_CASE, WIDE_CASE } from './scanCase'

vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('../../vendor/opencv/opencv.js') }
})

const DIR = 'tests/fixtures/scan'

interface Shot {
  file: string
  quad: Quad
}

const { shots } = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { shots: Shot[] }
// Shots with room above the card in the frame for a label.
const some = [0, 1, 3, 4, 5].map((i) => shots[i])

const load = (file: string): RgbaImage =>
  decode(readFileSync(join(DIR, file)), { useTArray: true, formatAsRGBA: true })

/**
 * img with a graded slab round the card at quad: a clear holder outline reaching `up` card
 * heights above the card, and in it a white label block of text-like bars. (The quad's sides are
 * taken as a parallelogram, which the fixtures' are near enough.)
 */
function inSlab(img: RgbaImage, quad: Quad, up = 0.34, labelWidth = 0.84): RgbaImage {
  const { width, height } = img
  const out = new Uint8ClampedArray(img.data)
  const [p0, p1, , p3] = quad
  const a = [p1[0] - p0[0], p1[1] - p0[1]]
  const b = [p3[0] - p0[0], p3[1] - p0[1]]
  const det = a[0] * b[1] - a[1] * b[0]
  const label = [(1 - labelWidth) / 2, 1 - (1 - labelWidth) / 2, -0.24, -0.07]
  const reach = Math.hypot(a[0], a[1]) + Math.hypot(b[0], b[1])
  const [cx, cy] = [p0[0] + (a[0] + b[0]) / 2, p0[1] + (a[1] + b[1]) / 2]
  for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(height, cy + reach); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(width, cx + reach); x++) {
      const [dx, dy] = [x - p0[0], y - p0[1]]
      const u = (dx * b[1] - dy * b[0]) / det
      const v = (a[0] * dy - a[1] * dx) / det
      if (u < -0.1 || u > 1.1 || v < -up || v > 1.05) continue
      const i = (y * width + x) * 4
      const onCard = u >= 0 && u <= 1 && v >= 0 && v <= 1
      const rim = u < -0.09 || u > 1.09 || v < -up + 0.012 || v > 1.04
      if (rim) {
        out[i] = out[i + 1] = out[i + 2] = 225
      } else if (u >= label[0] && u <= label[1] && v >= label[2] && v <= label[3]) {
        // Paper with a few rows of dark text.
        const row = Math.floor(((v - label[2]) / (label[3] - label[2])) * 9)
        const ink = row % 2 === 1 && (u * 60) % 3 < 2 && u < label[1] - 0.1
        out[i] = out[i + 1] = out[i + 2] = ink ? 40 : 245
      } else if (!onCard) {
        for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * 0.75 + 60 * 0.25
      }
    }
  }
  return { width, height, data: out }
}

/**
 * img with a TAG slab round the card at quad: a clear holder outline, and above the card a clear
 * label (the background shows through) with a thin white frame round it, its top line broken
 * by the TAG plaque, and rows of white print inside. `sides` false leaves the frame's sides out.
 */
function inTagSlab(img: RgbaImage, quad: Quad, sides = true): RgbaImage {
  const { width, height } = img
  const out = new Uint8ClampedArray(img.data)
  const [p0, p1, , p3] = quad
  const a = [p1[0] - p0[0], p1[1] - p0[1]]
  const b = [p3[0] - p0[0], p3[1] - p0[1]]
  const det = a[0] * b[1] - a[1] * b[0]
  const [top, bottom, left, right] = [-0.3, -0.06, -0.02, 1.02]
  // The frame's lines, about as thin as a real TAG label's: a few thousandths of the card across.
  const thick = Math.max(0.003, 1 / Math.hypot(b[0], b[1]))
  const thickU = Math.max(0.003, 1 / Math.hypot(a[0], a[1]))
  const reach = Math.hypot(a[0], a[1]) + Math.hypot(b[0], b[1])
  const [cx, cy] = [p0[0] + (a[0] + b[0]) / 2, p0[1] + (a[1] + b[1]) / 2]
  for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(height, cy + reach); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(width, cx + reach); x++) {
      const [dx, dy] = [x - p0[0], y - p0[1]]
      const u = (dx * b[1] - dy * b[0]) / det
      const v = (a[0] * dy - a[1] * dx) / det
      if (u < -0.1 || u > 1.1 || v < -0.4 || v > 1.05) continue
      const i = (y * width + x) * 4
      const inside = u > left && u < right && v > top && v < bottom
      const across =
        u >= left &&
        u <= right &&
        (Math.abs(v - bottom) < thick || (Math.abs(v - top) < thick && Math.abs(u - 0.5) > 0.1))
      const down =
        sides &&
        v >= top &&
        v <= bottom &&
        (Math.abs(u - left) < thickU || Math.abs(u - right) < thickU)
      const row = Math.floor(((v - top) / (bottom - top)) * 9)
      const print = inside && row % 2 === 1 && u > 0.05 && u < 0.6 && (u * 60) % 3 < 2
      if (across || down || print) out[i] = out[i + 1] = out[i + 2] = 240
    }
  }
  return { width, height, data: out }
}

let cv: CV
beforeAll(async () => {
  cv = await loadCv()
}, 30_000)

const slab = (img: RgbaImage, quad: Quad): boolean =>
  using([toMat(cv, img)], () => isSlab(cv, toMat(cv, img), quad))

describe('isSlab', () => {
  it('reads a bare card as not a slab', () => {
    for (const s of some) expect(slab(load(s.file), s.quad), s.file).toBe(false)
  })

  it('reads a card in a magnetic or toploader-like case as not a slab', () => {
    for (const s of some)
      for (const style of [TIGHT_CASE, WIDE_CASE])
        expect(slab(inCase(load(s.file), s.quad, style).img, s.quad), s.file).toBe(false)
  })

  it('reads a card with a label block above it, in a wider outline, as a slab', () => {
    for (const s of some) expect(slab(inSlab(load(s.file), s.quad), s.quad), s.file).toBe(true)
  })

  it('reads a blank white strip with no text as not a label', () => {
    for (const s of some) {
      const img = inSlab(load(s.file), s.quad)
      const flat = inSlab(load(s.file), s.quad, 0.34, 0.84)
      // Wipe the text: every dark label pixel becomes paper.
      for (let i = 0; i < flat.data.length; i += 4)
        if (flat.data[i] === 40 && flat.data[i + 1] === 40)
          flat.data[i] = flat.data[i + 1] = flat.data[i + 2] = 245
      expect(slab(flat, s.quad), s.file).toBe(false)
      expect(slab(img, s.quad), s.file).toBe(true)
    }
  })

  it('finds the label of a card read upside down, below its outline', () => {
    for (const s of some) {
      const turned: Quad = [s.quad[2], s.quad[3], s.quad[0], s.quad[1]]
      expect(slab(inSlab(load(s.file), s.quad), turned), s.file).toBe(true)
    }
  })
})

describe('a TAG slab (clear label, white frame)', () => {
  const found = (img: RgbaImage, quad: Quad, upsideDown: boolean | null = null): boolean => {
    const m = toMat(cv, img)
    return using([m], () => slabQuad(m, quad, upsideDown) !== null)
  }

  it('reads a card with a framed clear label above it as a slab', () => {
    for (const s of some) expect(found(inTagSlab(load(s.file), s.quad), s.quad), s.file).toBe(true)
  })

  it('finds it below a card read upside down, unless the art says it is upright', () => {
    for (const s of some) {
      const img = inTagSlab(load(s.file), s.quad)
      const turned: Quad = [s.quad[2], s.quad[3], s.quad[0], s.quad[1]]
      expect(found(img, turned), s.file).toBe(true)
      expect(found(img, turned, true), s.file).toBe(true)
      expect(found(img, turned, false), s.file).toBe(false)
    }
  })

  it('says a framed clear label is TAG, and a paper label names no grader', () => {
    const company = (img: RgbaImage, quad: Quad): string | undefined => {
      const m = toMat(cv, img)
      return using([m], () => slabQuad(m, quad)?.company)
    }
    for (const s of some) {
      expect(company(inTagSlab(load(s.file), s.quad), s.quad), s.file).toBe('TAG')
      expect(company(inSlab(load(s.file), s.quad), s.quad), s.file).toBeUndefined()
    }
  })

  it('reads two lines across with no sides as not a label', () => {
    for (const s of some)
      expect(found(inTagSlab(load(s.file), s.quad, false), s.quad), s.file).toBe(false)
  })
})

describe('analyze', () => {
  it('checks for a slab for every game', () => {
    const img = load(shots[0].file)
    for (const game of ['pkm', 'ygo'] as const) {
      const r = analyze(cv, img, null, null, false, false, scanProfile(game))
      expect(r.found).toBe(true)
      expect(r.slab).toBe(false)
    }
  })
})
