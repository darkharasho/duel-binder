// Synthetic camera conditions for a clean card scan: the card is set into a 1920x1080 frame at
// the size a webcam films it, tilted, lit off-white, glared, blurred, noised and JPEG'd, so cues
// are not tuned to pristine scans. Deterministic per seed.
import { decode, encode } from 'jpeg-js'
import type { RgbaImage } from '@shared/scan/types'
import type { CV } from '../../../src/renderer/src/features/scan/vision/cv'
import { toMat, using } from '../../../src/renderer/src/features/scan/vision/detect'

/** mulberry32: a small seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FRAME_W = 1920
const FRAME_H = 1080

export interface Degradation {
  /** Card height in the frame, px. */
  cardH: number
  blur: number
  noise: number
  quality: number
  glare: number
}

/** Composites RGBA scan pixels with transparency (rounded PNG corners) over grey. */
function flatten(img: RgbaImage): RgbaImage {
  const out = new Uint8ClampedArray(img.data.length)
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255
    for (let c = 0; c < 3; c++) out[i + c] = img.data[i + c] * a + 150 * (1 - a)
    out[i + 3] = 255
  }
  return { width: img.width, height: img.height, data: out }
}

/** The scan as a degraded 1920x1080 camera frame, and what was done to it. */
export function degrade(
  cv: CV,
  scan: RgbaImage,
  seed: number
): { frame: RgbaImage; how: Degradation } {
  const r = rng(seed)
  const between = (a: number, b: number): number => a + (b - a) * r()
  const how: Degradation = {
    cardH: Math.round(between(430, 760)),
    blur: between(0.4, 1.6),
    noise: between(1.5, 5),
    quality: Math.round(between(55, 88)),
    glare: r() < 0.6 ? between(0.15, 0.55) : 0
  }
  const cardW = (how.cardH * 59) / 86
  const cx = FRAME_W / 2 + between(-250, 250)
  const cy = FRAME_H / 2 + between(-60, 60)
  const angle = between(-0.12, 0.12)
  const jitter = (): number => between(-0.05, 0.05) * how.cardH
  const corners = [
    [-cardW / 2, -how.cardH / 2],
    [cardW / 2, -how.cardH / 2],
    [cardW / 2, how.cardH / 2],
    [-cardW / 2, how.cardH / 2]
  ].map(([x, y]) => [
    cx + x * Math.cos(angle) - y * Math.sin(angle) + jitter(),
    cy + x * Math.sin(angle) + y * Math.cos(angle) + jitter()
  ])
  const flat = flatten(scan)
  // Background: a warm desk with a gradient and some grain.
  const bg = new Uint8ClampedArray(FRAME_W * FRAME_H * 4)
  const tone = [between(150, 210), between(115, 165), between(80, 125)]
  for (let y = 0; y < FRAME_H; y++)
    for (let x = 0; x < FRAME_W; x++) {
      const i = (y * FRAME_W + x) * 4
      const g = 0.85 + 0.25 * (x / FRAME_W) + (6 * Math.sin(y / 9 + x / 400)) / 255
      bg[i] = tone[0] * g
      bg[i + 1] = tone[1] * g
      bg[i + 2] = tone[2] * g
      bg[i + 3] = 255
    }
  const src = toMat(cv, flat)
  const dst = toMat(cv, { width: FRAME_W, height: FRAME_H, data: bg })
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    flat.width,
    0,
    flat.width,
    flat.height,
    0,
    flat.height
  ])
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat())
  const blurred = new cv.Mat()
  const pixels = using([src, dst, from, to, blurred], () => {
    const m = cv.getPerspectiveTransform(from, to)
    try {
      cv.warpPerspective(
        src,
        dst,
        m,
        new cv.Size(FRAME_W, FRAME_H),
        cv.INTER_AREA,
        cv.BORDER_TRANSPARENT
      )
    } finally {
      m.delete()
    }
    cv.GaussianBlur(dst, blurred, new cv.Size(0, 0), how.blur)
    return new Uint8ClampedArray(blurred.data)
  })
  // White balance, exposure, glare streak and sensor noise.
  const wb = [between(0.88, 1.1), between(0.94, 1.04), between(0.82, 1.08)]
  const gain = between(0.8, 1.15)
  const gx = cx + between(-0.4, 0.4) * cardW
  const gy = cy + between(-0.4, 0.4) * how.cardH
  const ga = between(0, Math.PI)
  const gWidth = between(0.08, 0.3) * cardW
  for (let y = 0; y < FRAME_H; y++)
    for (let x = 0; x < FRAME_W; x++) {
      const i = (y * FRAME_W + x) * 4
      const d = Math.abs((x - gx) * Math.sin(ga) - (y - gy) * Math.cos(ga))
      const along = Math.hypot(x - gx, y - gy)
      const g = how.glare
        ? how.glare * Math.exp(-((d / gWidth) ** 2)) * Math.exp(-((along / how.cardH) ** 2))
        : 0
      for (let c = 0; c < 3; c++) {
        const v = pixels[i + c] * wb[c] * gain
        pixels[i + c] = v + (255 - v) * g + (r() - 0.5) * 2 * how.noise
      }
    }
  const jpeg = encode({ width: FRAME_W, height: FRAME_H, data: pixels }, how.quality)
  const frame = decode(jpeg.data, { useTArray: true, formatAsRGBA: true })
  return { frame: { width: frame.width, height: frame.height, data: frame.data }, how }
}
