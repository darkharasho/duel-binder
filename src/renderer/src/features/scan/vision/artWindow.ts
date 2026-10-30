import type { ScanProfile } from '@shared/scan/profiles'
import type { Box } from './regions'

/** A straightened card's pixels, RGBA: an RgbaImage, or an OpenCV Mat's cols, rows and data. */
export interface Pixels {
  width: number
  height: number
  data: ArrayLike<number>
}

/**
 * How far from where the profile puts it a window's border is looked for, as a share of the card:
 * near, and again wider for a card found by a frame well inside or outside it (a held card's
 * header lost under a deck's edge), where the near search finds nothing or the wrong line.
 */
const WINDOW_SEARCH = [0.03, 0.08]
/** How many times the median edge strength around it a border must be, to count as found. */
const WINDOW_MIN_PEAK = 1.6

const luma = (d: ArrayLike<number>, p: number): number =>
  0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]

/**
 * The strongest straight edge across (or, with vertical, down) the card near at: for each line
 * in reach, the mean over span of how much the pixels just past it differ from those just before
 * it, the border being one colour against art of any. Null when no line stands out of the rest.
 */
function edgeNear(
  img: Pixels,
  at: number,
  span: readonly [number, number],
  vertical: boolean,
  reach: number
): number | null {
  const { width, height, data } = img
  const along = vertical ? width : height
  const across = vertical ? height : width
  const step = Math.max(1, Math.round(along * 0.004))
  const lo = Math.max(step, Math.round((at - reach) * along))
  const hi = Math.min(along - 1 - step, Math.round((at + reach) * along))
  const from = Math.round(span[0] * across)
  const to = Math.round(span[1] * across)
  // Every other pixel along the line is plenty, and halves the work.
  const px = (line: number, i: number): number =>
    luma(data, vertical ? i * width + line : line * width + i)
  const strength: number[] = []
  for (let line = lo; line <= hi; line++) {
    let sum = 0
    let n = 0
    for (let i = from; i < to; i += 2) {
      sum += Math.abs(px(line + step, i) - px(line - step, i))
      n++
    }
    strength.push(n ? sum / n : 0)
  }
  if (!strength.length) return null
  const sorted = [...strength].sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  let best = 0
  for (let i = 1; i < strength.length; i++) if (strength[i] > strength[best]) best = i
  if (strength[best] < WINDOW_MIN_PEAK * Math.max(1, median)) return null
  return (lo + best) / along
}

/**
 * The art boxes put where the card's own art window is: each of profile's windows looked for
 * near where it should be, and the art box moved and scaled with it. An outline a percent off
 * costs the hash some 20 bits, and a card held over a deck is often found by its inner frame,
 * a few percent in; the printed window's border is crisp. Only windows found on all four sides
 * give a box.
 */
export function windowArtBoxes(img: Pixels, profile: ScanProfile): Box[] {
  const out: Box[] = []
  const [art] = profile.artBoxes
  for (const reach of WINDOW_SEARCH) {
    for (const w of profile.windows) {
      const inX: [number, number] = [w[0] + 0.1 * (w[2] - w[0]), w[2] - 0.1 * (w[2] - w[0])]
      const top = edgeNear(img, w[1], inX, false, reach)
      const bottom = edgeNear(img, w[3], inX, false, reach)
      if (top === null || bottom === null || bottom <= top) continue
      const inY: [number, number] = [top + 0.1 * (bottom - top), bottom - 0.1 * (bottom - top)]
      const left = edgeNear(img, w[0], inY, true, reach)
      const right = edgeNear(img, w[2], inY, true, reach)
      if (left === null || right === null || right <= left) continue
      const sx = (right - left) / (w[2] - w[0])
      const sy = (bottom - top) / (w[3] - w[1])
      const box: Box = [
        left + (art[0] - w[0]) * sx,
        top + (art[1] - w[1]) * sy,
        left + (art[2] - w[0]) * sx,
        top + (art[3] - w[1]) * sy
      ]
      const inside = box[0] >= 0 && box[1] >= 0 && box[2] <= 1 && box[3] <= 1
      if (inside && !out.some((b) => b.every((v, i) => Math.abs(v - box[i]) < 0.002))) out.push(box)
    }
  }
  return out
}
