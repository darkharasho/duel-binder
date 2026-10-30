import type { ArtWindow } from './foil'

/** An image's pixels: 4 bytes each, in any channel order (RGBA on a canvas, BGRA from nativeImage). */
export interface ArtBitmap {
  data: ArrayLike<number>
  width: number
  height: number
}

export interface DetectedArtWindow {
  window: ArtWindow
  /** How well the weakest side of the box lines up with an edge in the image, 0–1. */
  confidence: number
}

/** The width the image is reduced to first: enough to see the box, cheap to search. */
const WORK_WIDTH = 240
/** Two pixels this different (largest channel, 0–255) are an edge. */
const EDGE = 34
/** How far outside a side, in work pixels, the frame should be calm, and how much that counts. */
const CLEAR = 3
const CALM = 0.8
const INNER = 1
/** How far off centre the box may sit, in work pixels. */
const SKEW = 4
/** Below this the box is a guess: callers use a layout's table instead. */
export const MIN_CONFIDENCE = 0.5

/** The boxes to search: where each side may be (fractions of the card) and the box's shape. */
interface BoxSearch {
  top: number[]
  bottom: number[]
  left: number[]
  right: number[]
  aspect: number[]
  /** Whether the box sits the same distance from both edges of the card. */
  centred: boolean
  /** How much of the left end of each side to leave out, as a fraction of the card's width. */
  corner: number
}
const NORMAL_BOX: BoxSearch = {
  top: [0.05, 0.2],
  bottom: [0.38, 0.62],
  left: [0.055, 0.17],
  right: [0.83, 0.945],
  aspect: [1.25, 1.85],
  centred: true,
  corner: 0
}
/**
 * The e-Reader sets' box: off centre (it runs almost to the card's right edge) with its two left
 * corners rounded, so the sides are only measured where they're straight.
 */
const ROUNDED_LEFT_BOX: BoxSearch = {
  top: [0.08, 0.17],
  bottom: [0.44, 0.52],
  left: [0.05, 0.13],
  right: [0.9, 0.985],
  aspect: [1.25, 1.85],
  centred: false,
  corner: 0.07
}

/** The image box-averaged down to `w`×`h`, three channels per pixel. */
function shrink(image: ArtBitmap, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3)
  const counts = new Uint32Array(w * h)
  for (let y = 0; y < image.height; y++) {
    const row = Math.min(h - 1, Math.floor((y * h) / image.height))
    for (let x = 0; x < image.width; x++) {
      const cell = row * w + Math.min(w - 1, Math.floor((x * w) / image.width))
      const at = (y * image.width + x) * 4
      out[cell * 3] += image.data[at]
      out[cell * 3 + 1] += image.data[at + 1]
      out[cell * 3 + 2] += image.data[at + 2]
      counts[cell]++
    }
  }
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i] || 1
    out[i * 3] /= n
    out[i * 3 + 1] /= n
    out[i * 3 + 2] /= n
  }
  return out
}

const differ = (px: Float32Array, a: number, b: number): boolean =>
  Math.abs(px[a * 3] - px[b * 3]) > EDGE ||
  Math.abs(px[a * 3 + 1] - px[b * 3 + 1]) > EDGE ||
  Math.abs(px[a * 3 + 2] - px[b * 3 + 2]) > EDGE

/**
 * Finds a card's artwork box: the rectangle in the card's upper half whose four sides best follow
 * edges in the image. Each side is scored by the share of its length on an edge, less the edges just outside it; the box with the best sides
 * wins, and its weakest side is the confidence. Null when no box has the shape of a card's artwork at all.
 */
export function findArtWindow(
  image: ArtBitmap,
  { roundedLeft = false }: { roundedLeft?: boolean } = {}
): DetectedArtWindow | null {
  const search = roundedLeft ? ROUNDED_LEFT_BOX : NORMAL_BOX
  if (image.width < 40 || image.height < 40) return null
  const w = WORK_WIDTH
  const h = Math.round((image.height * w) / image.width)
  const px = shrink(image, w, h)

  const rowEdge = new Uint8Array(w * h)
  const colEdge = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (differ(px, i - w, i + w)) rowEdge[i] = 1
      if (differ(px, i - 1, i + 1)) colEdge[i] = 1
    }
  }
  // Running counts of edge pixels along each row (the box's top and bottom) and each column.
  const rows = new Uint16Array((w + 1) * h)
  const cols = new Uint16Array(w * (h + 1))
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      rows[y * (w + 1) + x + 1] = rows[y * (w + 1) + x] + rowEdge[y * w + x]
    }
  }
  for (let x = 1; x < w - 1; x++) {
    for (let y = 0; y < h; y++) {
      cols[(y + 1) * w + x] = cols[y * w + x] + colEdge[y * w + x]
    }
  }
  const across = (y: number, x0: number, x1: number): number =>
    (rows[y * (w + 1) + x1] - rows[y * (w + 1) + x0]) / (x1 - x0)
  const down = (x: number, y0: number, y1: number): number =>
    (cols[y1 * w + x] - cols[y0 * w + x]) / (y1 - y0)

  const range = ([a, b]: number[], n: number): [number, number] => [
    Math.round(a * n),
    Math.round(b * n)
  ]
  const [t0, t1] = range(search.top, h)
  const [b0, b1] = range(search.bottom, h)
  const [l0, l1] = range(search.left, w)
  const [r0, r1] = range(search.right, w)
  const cornerX = Math.round(search.corner * w)
  const cornerY = cornerX

  let best: { t: number; b: number; l: number; r: number; min: number; score: number } | null = null
  for (let t = t0; t <= t1; t++) {
    for (let b = b0; b <= b1; b++) {
      for (let l = l0; l <= l1; l++) {
        // Printed cards are centred: the box sits the same distance from either edge.
        const mirror = w - l
        const rFrom = search.centred ? Math.max(r0, mirror - SKEW) : r0
        const rTo = search.centred ? Math.min(r1, mirror + SKEW) : r1
        for (let r = rFrom; r <= rTo; r++) {
          const shape = ((r - l) * image.width * h) / w / ((b - t) * image.height)
          if (shape < search.aspect[0] || shape > search.aspect[1]) continue
          const x0 = l + cornerX
          const y0 = t + cornerY
          const y1 = b - cornerY
          // A side is a line with calm frame just outside it: art's own detail fails the second.
          const top = across(t, x0, r) - across(t - CLEAR, x0, r) * CALM
          const bottom = across(b, x0, r) - across(b + CLEAR, x0, r) * CALM
          const left = down(l, y0, y1) - down(l - CLEAR, y0, y1) * CALM
          const right = down(r, t, b) - down(Math.min(r + CLEAR, w - 2), t, b) * CALM
          const min = Math.min(top, bottom, left, right)
          // Led by the weakest side, so one strong line (a horizon) can't carry a box; a little
          // for a smaller box, so the card's border and the strip under the art don't win over
          // the art's own edges.
          const score =
            min * 2 + (top + bottom + left + right) / 4 - INNER * ((r - l) / w + (b - t) / h)
          if (!best || score > best.score) best = { t, b, l, r, min, score }
        }
      }
    }
  }
  if (!best) return null
  const pct = (n: number): number => Math.round(n * 1000) / 10
  return {
    window: {
      top: pct(best.t / h),
      bottom: pct(best.b / h),
      left: pct(best.l / w),
      right: pct(1 - best.r / w)
    },
    confidence: Math.round(best.min * 100) / 100
  }
}
