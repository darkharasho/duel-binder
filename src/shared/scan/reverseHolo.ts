import type { RgbaImage } from './types'
import refs from './reverseRefs.json'
import { REVERSE_BODY_LUM_MAX, REVERSE_SPREAD_MIN } from './thresholds'

/** Body brightness of an upright card relative to its art, and how uneven the body is. */
export interface BodyStats {
  /** Mean luma of the body divided by mean luma of the art. */
  ratio: number
  /** Std divided by mean of the body's luma. */
  spread: number
}

const W = 200
const H = 292
const ART = { x0: 0.06, x1: 0.94, y0: 0.09, y1: 0.47 }
const BODY = { x0: 0.05, x1: 0.95, y0: 0.54, y1: 0.86 }

/** Cards whose Reverse Holofoil printings the scanner can tell from Normal. */
export const REVERSE_CHECKED_SETS: readonly string[] = ['DLR']

/** True when the set code (like 'DLR 002/103') is in a set the check covers. */
export function reverseChecked(setCode: string | null): boolean {
  if (!setCode) return false
  return REVERSE_CHECKED_SETS.includes(setCode.split(' ')[0])
}

const bounds = (r: typeof ART) => ({
  x0: Math.round(r.x0 * W),
  x1: Math.round(r.x1 * W),
  y0: Math.round(r.y0 * H),
  y1: Math.round(r.y1 * H)
})

/**
 * Shrinks to W x H by area averaging, flattening alpha on white, into luma values. Only the
 * output pixels the ART and BODY regions read are computed; the rest stay 0.
 */
function shrinkLuma(img: RgbaImage): Float32Array {
  const { width, height, data } = img
  const out = new Float32Array(W * H)
  const sx = width / W
  const sy = height / H
  const regions = [bounds(ART), bounds(BODY)]
  const cx0 = Math.min(...regions.map((r) => r.x0))
  const cx1 = Math.max(...regions.map((r) => r.x1))
  // Per output column: its source x range and weights, the same for every row.
  const colStart = new Int32Array(W)
  const colEnd = new Int32Array(W)
  const colW: Float64Array[] = []
  for (let ox = cx0; ox < cx1; ox++) {
    const x0 = ox * sx
    const x1 = x0 + sx
    const xs = Math.floor(x0)
    const xe = Math.min(width, Math.ceil(x1))
    colStart[ox] = xs
    colEnd[ox] = xe
    const ws = new Float64Array(Math.max(0, xe - xs))
    for (let x = xs; x < xe; x++) ws[x - xs] = Math.min(x + 1, x1) - Math.max(x, x0)
    colW[ox] = ws
  }
  for (let oy = 0; oy < H; oy++) {
    if (!regions.some((r) => oy >= r.y0 && oy < r.y1)) continue
    const y0 = oy * sy
    const y1 = y0 + sy
    const ys = Math.floor(y0)
    const ye = Math.min(height, Math.ceil(y1))
    for (let ox = cx0; ox < cx1; ox++) {
      const xs = colStart[ox]
      const xe = colEnd[ox]
      const ws = colW[ox]
      let sum = 0
      let wsum = 0
      for (let y = ys; y < ye; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        let i = (y * width + xs) * 4
        for (let x = xs; x < xe; x++, i += 4) {
          const w = wy * ws[x - xs]
          const al = data[i + 3]
          let lum: number
          if (al === 255) {
            lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          } else {
            const a = al / 255
            const r = data[i] * a + 255 * (1 - a)
            const g = data[i + 1] * a + 255 * (1 - a)
            const b = data[i + 2] * a + 255 * (1 - a)
            lum = 0.299 * r + 0.587 * g + 0.114 * b
          }
          sum += w * lum
          wsum += w
        }
      }
      out[oy * W + ox] = wsum > 0 ? sum / wsum : 255
    }
  }
  return out
}

function region(luma: Float32Array, r: typeof ART): { mean: number; std: number } {
  const x0 = Math.round(r.x0 * W)
  const x1 = Math.round(r.x1 * W)
  const y0 = Math.round(r.y0 * H)
  const y1 = Math.round(r.y1 * H)
  let sum = 0
  let sq = 0
  let n = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const v = luma[y * W + x]
      sum += v
      sq += v * v
      n++
    }
  const mean = sum / n
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) }
}

/** Measures an upright card image at 200x292, whatever its size. */
export function bodyStats(img: RgbaImage): BodyStats {
  const luma = shrinkLuma(img)
  const art = region(luma, ART)
  const body = region(luma, BODY)
  return { ratio: body.mean / Math.max(art.mean, 1e-6), spread: body.mean > 0 ? body.std / body.mean : 0 }
}

/** Reverse Holofoil if the body is much darker than the reference's, or much more uneven. */
export function reverseVersion(photo: BodyStats, ref: BodyStats): 'Normal' | 'Reverse Holofoil' {
  const bodyLum = photo.ratio / ref.ratio
  const spread = photo.spread - ref.spread
  return bodyLum < REVERSE_BODY_LUM_MAX || spread > REVERSE_SPREAD_MIN ? 'Reverse Holofoil' : 'Normal'
}

const REFS: Record<string, number[]> = refs.refs

/** The shipped reference stats of an image, or null when its set isn't covered. */
export function reverseRefStats(imageId: number): BodyStats | null {
  const r = REFS[String(imageId)]
  return r ? { ratio: r[0], spread: r[1] } : null
}
