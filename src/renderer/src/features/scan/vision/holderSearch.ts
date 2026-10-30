// Where to look again when a frame's first search finds no card whose art matches: a card in a
// toploader, case or slab is small in the frame and its outline loses to the holder's rim, and a
// bare card held over a deck has no outline of its own. Each region is cut from the full-size
// frame and searched again with the same line and quad search, so the card spans several times
// more pixels and the rim is no longer the strongest quad there. Only geometry lives here; the
// search itself is candidates.ts's.
import type { Point, Quad } from './detect'

/** An upright rectangle of the frame, in its pixels: [x0, y0) to [x1, y1). */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Regions looked in at most, per frame. */
export const MAX_REGIONS = 3
/** A region overlapping an earlier one by this much (intersection over union) is the same. */
const SAME_REGION = 0.6

const width = (r: Rect): number => r.x1 - r.x0
const height = (r: Rect): number => r.y1 - r.y0

/**
 * The quad's bounding rectangle grown by margin (a share of its width and height) on every side,
 * kept inside the frame, in whole pixels; null when nothing of it is left.
 */
export function regionAround(
  quad: readonly Point[],
  margin: number,
  frameWidth: number,
  frameHeight: number
): Rect | null {
  const xs = quad.map((p) => p[0])
  const ys = quad.map((p) => p[1])
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys)
  ]
  const mx = margin * (maxX - minX)
  const my = margin * (maxY - minY)
  const r: Rect = {
    x0: Math.max(0, Math.floor(minX - mx)),
    y0: Math.max(0, Math.floor(minY - my)),
    x1: Math.min(frameWidth, Math.ceil(maxX + mx)),
    y1: Math.min(frameHeight, Math.ceil(maxY + my))
  }
  return width(r) > 0 && height(r) > 0 ? r : null
}

/** Intersection over union of two rectangles. */
export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  const both = w * h
  return both / (width(a) * height(a) + width(b) * height(b) - both)
}

/**
 * The first max of regions, in order, leaving out any that is the same as one kept already
 * (SAME_REGION), or smaller than minSide pixels on a side: too little to search again.
 */
export function pickRegions(
  regions: readonly (Rect | null)[],
  max = MAX_REGIONS,
  minSide = 0
): Rect[] {
  const kept: Rect[] = []
  for (const r of regions) {
    if (kept.length >= max) break
    if (!r || Math.min(width(r), height(r)) < minSide) continue
    if (kept.some((k) => overlap(k, r) >= SAME_REGION)) continue
    kept.push(r)
  }
  return kept
}

/** A quad found in region r shrunk or grown by scale, in the frame's pixels. */
export function fromRegion(quad: Quad, r: Rect, scale: number): Quad {
  return quad.map(([x, y]) => [r.x0 + x / scale, r.y0 + y / scale]) as unknown as Quad
}

/**
 * The middle of the frame, where the scan window and the phone have the card held: the middle
 * 60% across and 90% down, so a card held upright at any distance is inside it.
 */
export function centreRegion(frameWidth: number, frameHeight: number): Rect {
  return {
    x0: Math.round(0.2 * frameWidth),
    y0: Math.round(0.05 * frameHeight),
    x1: Math.round(0.8 * frameWidth),
    y1: Math.round(0.95 * frameHeight)
  }
}
