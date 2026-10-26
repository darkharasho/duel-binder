import type { Mat } from '@techstark/opencv-js'
import { artHash } from '@shared/scan/fingerprint'
import type { FingerprintIndex } from '@shared/scan/fingerprintFile'
import type { RgbaImage } from '@shared/scan/types'
import type { CV } from './cv'
import { ART_BOXES, type Box } from './regions'

export type Point = readonly [number, number]
/** Card corners, clockwise from top-left. */
export type Quad = readonly [Point, Point, Point, Point]

/** Short side over long side of a card (59 x 86 mm), and how far off a detection may be. */
const CARD_ASPECT = 0.69
const ASPECT_TOLERANCE = 0.08
/** Smallest card, as a share of the frame area. */
export const MIN_AREA = 0.04
/** Frames are searched at this width at most; corners are scaled back up. */
export const SEARCH_WIDTH = 640
const CANNY_LOW = 30
const CANNY_HIGH = 90
export const CARD_W = 842
const CARD_H = 1228
const TOP_MATCHES = 5

/**
 * A frame: its pixels, or the pixels already copied into OpenCV as an RGBA Mat, so a frame that
 * is straightened many times is copied into the WASM heap only once. A Mat stays the caller's.
 */
export type FrameSource = RgbaImage | Mat

const isMat = (src: FrameSource): src is Mat => 'cols' in src

/** The pixels copied into a new RGBA Mat, for the caller to delete. */
export function toMat(cv: CV, img: RgbaImage): Mat {
  const mat = new cv.Mat(img.height, img.width, cv.CV_8UC4)
  try {
    mat.data.set(img.data)
    return mat
  } catch (e) {
    mat.delete()
    throw e
  }
}

/** Deletes every mat once fn is done with them, even when it throws. */
export function using<T>(mats: { delete(): void }[], fn: () => T): T {
  try {
    return fn()
  } finally {
    for (const m of mats) m.delete()
  }
}

export const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * Orders four corners clockwise from the top-left one, starting on a short side so a sideways
 * card comes out upright. Which short side is the card's top can't be told from the outline, so
 * the straightened card may be upside down: callers try it both ways (see rotate180).
 */
export function orderCorners(pts: Point[]): Quad {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4
  // With y pointing down, increasing angle runs clockwise.
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)
  )
  let start = sorted.reduce(
    (best, p, i) => (p[0] + p[1] < sorted[best][0] + sorted[best][1] ? i : best),
    0
  )
  if (
    dist(sorted[start], sorted[(start + 1) % 4]) >
    dist(sorted[(start + 1) % 4], sorted[(start + 2) % 4])
  )
    start = (start + 1) % 4
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as unknown as Quad
}

/** Short side over long side of a quad, averaging opposite sides. */
function aspect(q: Point[]): number {
  const a = (dist(q[0], q[1]) + dist(q[2], q[3])) / 2
  const b = (dist(q[1], q[2]) + dist(q[3], q[0])) / 2
  return Math.min(a, b) / Math.max(a, b)
}

/** The frame's width in pixels. */
export const frameWidth = (src: FrameSource): number => (isMat(src) ? src.cols : src.width)

/** img shrunk by scale (when below 1) and blurred, the frame edges are searched in. */
export function searchImage(cv: CV, img: FrameSource, scale: number): Mat {
  // A Mat is read from and left alone; pixels are copied in and worked on in place.
  const small = isMat(img) ? new cv.Mat() : toMat(cv, img)
  try {
    const from = isMat(img) ? img : small
    if (scale < 1) {
      const size = new cv.Size(Math.round(from.cols * scale), Math.round(from.rows * scale))
      cv.resize(from, small, size, 0, 0, cv.INTER_AREA)
    } else if (from !== small) {
      from.copyTo(small)
    }
    cv.GaussianBlur(small, small, new cv.Size(5, 5), 0)
    return small
  } catch (e) {
    small.delete()
    throw e
  }
}

/** Edges of a search image, from each colour channel. */
export function edgeMap(cv: CV, small: Mat): Mat {
  const channels = new cv.MatVector()
  const channelEdges = new cv.Mat()
  const edges = cv.Mat.zeros(small.rows, small.cols, cv.CV_8UC1)
  try {
    // A card can match its background in brightness but not in hue.
    cv.split(small, channels)
    for (let c = 0; c < 3; c++) {
      const channel = channels.get(c)
      try {
        cv.Canny(channel, channelEdges, CANNY_LOW, CANNY_HIGH)
        cv.bitwise_or(edges, channelEdges, edges)
      } finally {
        channel.delete()
      }
    }
    return edges
  } catch (e) {
    edges.delete()
    throw e
  } finally {
    channels.delete()
    channelEdges.delete()
  }
}

/** edges thickened by a pixel each way to join small gaps. */
export function thicken(cv: CV, edges: Mat): Mat {
  const thick = new cv.Mat()
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U)
  try {
    cv.dilate(edges, thick, kernel)
    return thick
  } catch (e) {
    thick.delete()
    throw e
  } finally {
    kernel.delete()
  }
}

/**
 * The card in a frame: the largest convex four-sided outline with a card's aspect ratio
 * (upright or sideways) covering at least MIN_AREA of the frame, or null when there is none.
 */
export function findCard(cv: CV, img: RgbaImage): Quad | null {
  const scale = Math.min(1, SEARCH_WIDTH / img.width)
  const small = searchImage(cv, img, scale)
  const thin = using([small], () => edgeMap(cv, small))
  const edges = using([thin], () => thicken(cv, thin))
  return using([edges], () => outlineQuad(cv, edges, scale))
}

/**
 * The largest convex four-sided outline with a card's aspect ratio in a thickened edge map of a
 * frame shrunk by scale, in full-frame coordinates.
 */
export function outlineQuad(cv: CV, edges: Mat, scale: number): Quad | null {
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const hull = new cv.Mat()
  const approx = new cv.Mat()
  return using([contours, hierarchy, hull, approx], () => {
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
    const minArea = MIN_AREA * edges.rows * edges.cols
    let best: Point[] | null = null
    let bestArea = 0
    for (let i = 0; i < contours.size(); i++) {
      // Card outlines rarely close all the way round, so judge each edge group by its hull.
      const contour = contours.get(i)
      try {
        cv.convexHull(contour, hull)
      } finally {
        contour.delete()
      }
      const area = cv.contourArea(hull)
      if (area < minArea || area <= bestArea) continue
      cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true)
      if (approx.rows !== 4) continue
      const pts: Point[] = [0, 1, 2, 3].map((j) => [
        approx.data32S[j * 2] / scale,
        approx.data32S[j * 2 + 1] / scale
      ])
      if (Math.abs(aspect(pts) - CARD_ASPECT) > ASPECT_TOLERANCE) continue
      best = pts
      bestArea = area
    }
    return best && orderCorners(best)
  })
}

/** fn given the frame as a Mat: the frame itself when it is one, else a copy deleted after. */
export function withMat<T>(cv: CV, img: FrameSource, fn: (frame: Mat) => T): T {
  if (isMat(img)) return fn(img)
  const frame = toMat(cv, img)
  return using([frame], () => fn(frame))
}

/** The card inside quad, straightened to width x (width * 1228 / 842). */
export function warpCard(cv: CV, img: FrameSource, quad: Quad, width = CARD_W): RgbaImage {
  const height = Math.round((width * CARD_H) / CARD_W)
  return withMat(cv, img, (src) => {
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat())
    return using([from], () => {
      const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height])
      const out = new cv.Mat()
      return using([to, out], () => {
        const m = cv.getPerspectiveTransform(from, to)
        try {
          cv.warpPerspective(
            src,
            out,
            m,
            new cv.Size(width, height),
            cv.INTER_LINEAR,
            cv.BORDER_REPLICATE
          )
        } finally {
          m.delete()
        }
        return { width, height, data: new Uint8ClampedArray(out.data) }
      })
    })
  })
}

/** img turned upside down. */
export function rotate180(img: RgbaImage): RgbaImage {
  const { data } = img
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0, j = data.length - 4; j >= 0; i += 4, j -= 4) {
    out[i] = data[j]
    out[i + 1] = data[j + 1]
    out[i + 2] = data[j + 2]
    out[i + 3] = data[j + 3]
  }
  return { width: img.width, height: img.height, data: out }
}

/** artHash of the part of card inside box, shrunk to the hash's 32x32 grid first. */
function hashBox(cv: CV, card: Mat, box: Box): Uint32Array {
  const x0 = Math.round(box[0] * card.cols)
  const y0 = Math.round(box[1] * card.rows)
  const rect = new cv.Rect(
    x0,
    y0,
    Math.round(box[2] * card.cols) - x0,
    Math.round(box[3] * card.rows) - y0
  )
  const roi = card.roi(rect)
  const small = new cv.Mat()
  return using([roi, small], () => {
    cv.resize(roi, small, new cv.Size(32, 32), 0, 0, cv.INTER_AREA)
    return artHash({ width: 32, height: 32, data: small.data })
  })
}

/**
 * A straightened card's k closest artworks, and whether the best of them matched it upside down.
 */
export function rankArt(
  cv: CV,
  card: RgbaImage,
  index: FingerprintIndex,
  candidates?: ReadonlySet<number>,
  k = TOP_MATCHES
): { matches: { imageId: number; distance: number }[]; upsideDown: boolean } {
  const upright = toMat(cv, card)
  const flipped = new cv.Mat()
  return using([upright, flipped], () => {
    // Flipping both axes turns the card 180 degrees.
    cv.flip(upright, flipped, -1)
    const best = new Map<number, { distance: number; upsideDown: boolean }>()
    for (const mat of [upright, flipped]) {
      for (const box of Object.values(ART_BOXES)) {
        const hash = hashBox(cv, mat, box)
        for (const { imageId, distance } of index.nearest(hash, k, candidates)) {
          const prev = best.get(imageId)
          if (prev === undefined || distance < prev.distance)
            best.set(imageId, { distance, upsideDown: mat === flipped })
        }
      }
    }
    const ranked = [...best]
      .map(([imageId, m]) => ({ imageId, ...m }))
      .sort((a, b) => a.distance - b.distance || a.imageId - b.imageId)
      .slice(0, k)
    return {
      matches: ranked.map(({ imageId, distance }) => ({ imageId, distance })),
      upsideDown: ranked[0]?.upsideDown ?? false
    }
  })
}

/**
 * The closest artworks to a straightened card, keeping each image's best distance over each art
 * box (normal and Pendulum frames) and both ways up, since the card may be upside down.
 * Optionally limited to candidate image ids.
 */
export function matchArt(
  cv: CV,
  card: RgbaImage,
  index: FingerprintIndex,
  candidates?: ReadonlySet<number>
): { imageId: number; distance: number }[] {
  return rankArt(cv, card, index, candidates).matches
}
