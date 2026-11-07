import { ART_MAX_DISTANCE } from '@shared/scan/thresholds'
import { crop } from '@shared/scan/regions'
import type { RgbaImage } from '@shared/scan/types'
import type { CropRect } from '../crop'
import type { Quad } from './detect'

/**
 * A whole-frame outline counts as cut off by the crop when at least this share of its width lies
 * inside the crop and some of it outside, past its left or right side.
 */
export const CUT_MIN_INSIDE = 0.25
/** The region read round a cut-off outline is grown by this share of its size on each side. */
export const CUT_MARGIN = 0.06

const xs = (quad: Quad): [number, number] => {
  const x = quad.map(([px]) => px)
  return [Math.min(...x), Math.max(...x)]
}

/**
 * The first of outlines (whole-frame pixels, likeliest first) that the crop cuts off at its left or
 * right side (CUT_MIN_INSIDE), and the region round it to read (CUT_MARGIN), within the frame;
 * null when the crop cuts none. A card held off-centre in a webcam's 16:9 picture runs past the 3:4
 * preview crop, and inside the crop its outline is lost.
 */
export function cutOffRegion(
  outlines: readonly Quad[],
  region: CropRect,
  frameWidth: number,
  frameHeight: number
): { quad: Quad; rect: CropRect } | null {
  const [left, right] = [region.x, region.x + region.width]
  for (const quad of outlines) {
    const [x0, x1] = xs(quad)
    const width = x1 - x0
    if (width <= 0) continue
    const inside = Math.min(x1, right) - Math.max(x0, left)
    if (inside < CUT_MIN_INSIDE * width || (x0 >= left && x1 <= right)) continue
    const ys = quad.map(([, y]) => y)
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
    const mx = CUT_MARGIN * width
    const my = CUT_MARGIN * (y1 - y0)
    const rx = Math.max(0, Math.floor(x0 - mx))
    const ry = Math.max(0, Math.floor(y0 - my))
    const rw = Math.min(frameWidth, Math.ceil(x1 + mx)) - rx
    const rh = Math.min(frameHeight, Math.ceil(y1 + my)) - ry
    if (rw > 0 && rh > 0) return { quad, rect: { x: rx, y: ry, width: rw, height: rh } }
  }
  return null
}

/** quad moved by (dx, dy). */
export function shiftQuad(quad: Quad, dx: number, dy: number): Quad {
  return quad.map(([x, y]) => [x + dx, y + dy]) as unknown as Quad
}

/**
 * quad, in whole-frame pixels, in region's own pixels; null when any corner falls outside it, as
 * an outline only partly in the crop can't be tried there.
 */
export function quadInRegion(quad: Quad, region: CropRect): Quad | null {
  const inside = quad.every(
    ([x, y]) =>
      x >= region.x &&
      y >= region.y &&
      x <= region.x + region.width &&
      y <= region.y + region.height
  )
  return inside ? shiftQuad(quad, -region.x, -region.y) : null
}

/** frame's pixels inside rect. */
export function cropRect(frame: RgbaImage, rect: CropRect): RgbaImage {
  const { x, y, width, height } = rect
  return crop(frame, [
    x / frame.width,
    y / frame.height,
    (x + width) / frame.width,
    (y + height) / frame.height
  ])
}

/** What readFramed needs of a frame's signals. */
interface Framed {
  found: boolean
  quad: Quad | null
  art: readonly { distance: number }[]
}

const topOf = (f: Framed): number => f.art[0]?.distance ?? Infinity

/**
 * A live frame read at region (the preview's centre crop). When its art matched nothing within
 * ART_MAX_DISTANCE, the whole frame's outlines (outlines, a quick search) are looked at for a card
 * the crop cuts off (cutOffRegion); if one is, the region round it is read too, with that outline
 * to try first, and kept when its art came as close or closer. Only that frame: the next starts at the crop
 * again, so the cost is one outline search per frame that matched nothing, and a second read only
 * while a card is held across the crop's side (a sticky switch to the whole frame, v0.63.2, made
 * scanning choppy). read is given the pixels and the outline to try first. The whole frame is read
 * when region is null (the phone, aimed at the card). The quad comes back in the whole frame's
 * pixels either way.
 */
export function readFramed<T extends Framed>(
  frame: RgbaImage,
  region: CropRect | null,
  read: (img: RgbaImage, first: Quad | null) => T,
  outlines: (img: RgbaImage) => Quad[],
  held: Quad | null = null
): T {
  if (!region) return read(frame, held)
  const placed = (f: T, at: CropRect): T =>
    f.quad ? { ...f, quad: shiftQuad(f.quad, at.x, at.y) } : f
  const first = read(cropRect(frame, region), held ? quadInRegion(held, region) : null)
  if (first.found && topOf(first) <= ART_MAX_DISTANCE) return placed(first, region)
  const cut = cutOffRegion(outlines(frame), region, frame.width, frame.height)
  if (!cut) return placed(first, region)
  const again = read(cropRect(frame, cut.rect), shiftQuad(cut.quad, -cut.rect.x, -cut.rect.y))
  // As close or closer: the whole card is likelier the card than the part the crop shows.
  return again.found && topOf(again) <= topOf(first)
    ? placed(again, cut.rect)
    : placed(first, region)
}
