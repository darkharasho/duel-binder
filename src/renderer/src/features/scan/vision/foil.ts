import type { SurfaceReading } from '@shared/scan/surface'
import type { RgbaImage } from '@shared/scan/types'
import type { Box } from './regions'

/**
 * The strips of frame beside the artwork, left and right, on a straightened card. Every frame but
 * a Pendulum's leaves them plain card stock unless the whole card is foil (Starlight, Quarter
 * Century Secret), whose glitter and holo lines cover them too.
 */
export const FRAME_STRIPS = [
  [0.025, 0.2, 0.085, 0.68],
  [0.915, 0.2, 0.975, 0.68]
] as const satisfies readonly Box[]

/**
 * The effect text: plain paper and crisp print on every card but a whole-card foil, so it shows
 * how sharp and noisy the shot is.
 */
export const TEXT_AREA = [0.09, 0.78, 0.91, 0.89] as const satisfies Box

/**
 * Cards are measured at half the straightened width (421 px), about the size a webcam films a
 * held card, so a sharp photo and a soft one show about the same detail.
 */
const SHRINK = 2

/** Texture of one region, in luma levels. */
export interface Texture {
  /** Mean |L - mean of its 3x3 neighbourhood|: the finest texture. */
  fine: number
  /** Median of the same: the texture between edges, glitter or paper. */
  floor: number
  /** Its 98th percentile: the sharpest edges. */
  edges: number
  /** Mean |L - mean of its 7x7 neighbourhood|: coarser texture, holo lines. */
  coarse: number
}

/** Luma of the region inside box, shrunk by SHRINK. */
function luma(img: RgbaImage, box: Box): { w: number; h: number; l: Float32Array } {
  const x0 = Math.round(box[0] * img.width)
  const y0 = Math.round(box[1] * img.height)
  const w = Math.max(0, Math.floor((Math.round(box[2] * img.width) - x0) / SHRINK))
  const h = Math.max(0, Math.floor((Math.round(box[3] * img.height) - y0) / SHRINK))
  const l = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = 0; dy < SHRINK; dy++) {
        let i = ((y0 + y * SHRINK + dy) * img.width + x0 + x * SHRINK) * 4
        for (let dx = 0; dx < SHRINK; dx++, i += 4)
          sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
      }
      l[y * w + x] = sum / (SHRINK * SHRINK)
    }
  return { w, h, l }
}

/** The mean of every (2r+1)-square neighbourhood, edges clamped. */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const side = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / side
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / side
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** The level below which share of the counted values lie, in steps of 1/STEPS. */
function quantile(counts: Uint32Array, total: number, share: number): number {
  let seen = 0
  for (let v = 0; v < counts.length; v++) {
    seen += counts[v]
    if (seen >= share * total) return (v + 0.5) / STEPS
  }
  return counts.length / STEPS
}

/** Fine texture is counted in quarter levels for its median and 98th percentile. */
const STEPS = 4

/** The texture of the region of img inside box. */
export function texture(img: RgbaImage, box: Box): Texture {
  const { w, h, l } = luma(img, box)
  const m1 = boxMean(l, w, h, 1)
  const m3 = boxMean(l, w, h, 3)
  const counts = new Uint32Array(256 * STEPS)
  let fine = 0
  let coarse = 0
  let n = 0
  // The outermost pixels see a clamped neighbourhood; they are left out.
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x
      const d = Math.abs(l[i] - m1[i])
      counts[Math.min(counts.length - 1, (d * STEPS) | 0)]++
      fine += d
      coarse += Math.abs(l[i] - m3[i])
      n++
    }
  return {
    fine: fine / (n || 1),
    floor: quantile(counts, n, 0.5),
    edges: quantile(counts, n, 0.98),
    coarse: coarse / (n || 1)
  }
}

/**
 * What the frame strips and the effect text show of a straightened card's surface: the texture
 * of the strips (averaged over both) and of the text. Measured on any card; on a Pendulum frame
 * the strips are artwork, so the decision, which knows the frame type, ignores it there.
 */
export function surface(card: RgbaImage): SurfaceReading {
  const [left, right] = FRAME_STRIPS.map((box) => texture(card, box))
  const text = texture(card, TEXT_AREA)
  return {
    frameFloor: (left.floor + right.floor) / 2,
    frameCoarse: (left.coarse + right.coarse) / 2,
    textEdges: text.edges,
    textFine: text.fine
  }
}
