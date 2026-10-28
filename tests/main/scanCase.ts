// Synthetic magnetic one-touch cases for the scan vision tests: a fixture shot's card put inside a
// thick clear acrylic slab drawn over the frame, so the case scenario needs no new image files.
import type { RgbaImage } from '../../src/shared/scan/types'

type Point = readonly [number, number]
type Quad = readonly [Point, Point, Point, Point]

export interface CaseStyle {
  /** Clear border around the card, as a share of the card's width (the same in mm on every side). */
  border: number
  /** Corner radius of the slab, as a share of the card's width. */
  radius: number
  /** Tint the acrylic adds over the desk, and how strongly (0-1). */
  tint: readonly [number, number, number]
  tintAlpha: number
  /** Specular streaks across the slab: how many, and their peak strength (0-1). */
  streaks: number
  glare: number
  seed: number
}

/** A 35pt magnetic one-touch: a narrow clear border, a recess bevel and a little glare. */
export const TIGHT_CASE: CaseStyle = {
  border: 0.07,
  radius: 0.06,
  tint: [200, 215, 225],
  tintAlpha: 0.22,
  streaks: 2,
  glare: 0.45,
  seed: 3
}

/** A thick (100pt+) one-touch: a wide border whose outline is near enough card-shaped, and glare. */
export const WIDE_CASE: CaseStyle = {
  border: 0.2,
  radius: 0.08,
  tint: [190, 205, 220],
  tintAlpha: 0.3,
  streaks: 3,
  glare: 0.6,
  seed: 11
}

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The 3x3 homography (row-major, h[8] = 1) taking the unit square's corners onto quad's. */
function squareTo(quad: Quad): number[] {
  const square = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ]
  const a: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [u, v] = square[i]
    const [x, y] = quad[i]
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x])
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y, y])
  }
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    ;[a[c], a[p]] = [a[p], a[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = a[r][c] / a[c][c]
      for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k]
    }
  }
  return [...a.map((row, i) => row[8] / row[i]), 1]
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det
  ]
}

const apply = (m: number[], x: number, y: number): Point => {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

/** The point at (u, v) of the card whose corners are quad, u across it and v down it (0-1). */
export function cardPoint(quad: Quad, u: number, v: number): Point {
  return apply(squareTo(quad), u, v)
}

/**
 * img with the card at quad (corners clockwise from its top-left) inside a magnetic one-touch
 * case: a rounded acrylic slab tinting the desk around the card, a bright rim and a dark inner
 * edge at its outline, the recess's bevel line just outside the card, the magnet seam across the
 * top border, a light haze over everything under the acrylic and a few specular streaks. Returns
 * the new frame and the slab's outer corners.
 */
export function inCase(
  img: RgbaImage,
  quad: Quad,
  style: CaseStyle
): { img: RgbaImage; outer: Quad } {
  const { width, height } = img
  const rand = rng(style.seed)
  const toFrame = squareTo(quad)
  const toCard = invert3(toFrame)
  // Card proportions (59 x 86 mm): v is stretched, so a border the same in mm is shorter in v.
  const bu = style.border
  const bv = (style.border * 59) / 86
  const ru = style.radius
  const [u0, v0, u1, v1] = [-bu, -bv, 1 + bu, 1 + bv]
  // Signed distance to the slab's rounded outline, in card widths (negative inside), measured
  // where v is scaled back to the card's true height so a card width is the same both ways.
  const tall = 86 / 59
  const [hx, hy] = [(u1 - u0) / 2, ((v1 - v0) * tall) / 2]
  const slab = (u: number, v: number): number => {
    const qx = Math.abs(u - 0.5) - hx + ru
    const qy = Math.abs((v - 0.5) * tall) - hy + ru
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - ru
  }
  // Streaks: bands across the slab at a slant, given by direction, offset and width (card units).
  const streaks = Array.from({ length: style.streaks }, () => {
    const angle = 0.5 + rand() * 0.9
    return {
      nx: Math.cos(angle),
      ny: Math.sin(angle),
      at: -0.2 + rand() * 1.4,
      width: 0.03 + rand() * 0.08,
      strength: style.glare * (0.6 + 0.4 * rand())
    }
  })
  const out = new Uint8ClampedArray(img.data)
  // Only pixels inside the slab's bounding box can change.
  const corners = [
    apply(toFrame, u0, v0),
    apply(toFrame, u1, v0),
    apply(toFrame, u1, v1),
    apply(toFrame, u0, v1)
  ]
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const bevel = 0.012
  for (
    let y = Math.max(0, Math.floor(Math.min(...ys)) - 2);
    y < Math.min(height, Math.ceil(Math.max(...ys)) + 2);
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(Math.min(...xs)) - 2);
      x < Math.min(width, Math.ceil(Math.max(...xs)) + 2);
      x++
    ) {
      const [u, v] = apply(toCard, x, y)
      const d = slab(u, v)
      if (d > 0.004) continue
      const i = (y * width + x) * 4
      let [r, g, b] = [out[i], out[i + 1], out[i + 2]]
      const onCard = u >= 0 && u <= 1 && v >= 0 && v <= 1
      if (!onCard) {
        // Acrylic over the desk: tinted and lifted.
        const t = style.tintAlpha
        r = r * (1 - t) + style.tint[0] * t
        g = g * (1 - t) + style.tint[1] * t
        b = b * (1 - t) + style.tint[2] * t
      }
      // Haze over everything under the acrylic.
      r = r * 0.92 + 255 * 0.06
      g = g * 0.92 + 255 * 0.06
      b = b * 0.92 + 255 * 0.06
      // The slab's polished rim: bright outside, a dark line just inside.
      if (d > -0.008) {
        r = g = b = 235
      } else if (d > -0.016) {
        r *= 0.55
        g *= 0.55
        b *= 0.55
      }
      // The recess the card sits in: a pale bevel line just outside the card.
      const outside = Math.max(-u, u - 1, (-v * 86) / 59, ((v - 1) * 86) / 59)
      if (outside > 0.004 && outside < 0.004 + bevel) {
        r = r * 0.5 + 210 * 0.5
        g = g * 0.5 + 215 * 0.5
        b = b * 0.5 + 220 * 0.5
      }
      // The magnet seam across the top border.
      if (!onCard && v < 0 && Math.abs(v + bv / 2) < 0.003) {
        r *= 0.6
        g *= 0.6
        b *= 0.6
      }
      for (const s of streaks) {
        const off = Math.abs(u * s.nx + ((v * 86) / 59) * s.ny - s.at)
        if (off < s.width) {
          const k = s.strength * (1 - off / s.width) ** 1.5
          r += (255 - r) * k
          g += (255 - g) * k
          b += (255 - b) * k
        }
      }
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
    }
  }
  return { img: { width, height, data: out }, outer: corners as unknown as Quad }
}
