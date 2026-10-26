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
const MIN_AREA = 0.08
/** Frames are searched at this width at most; corners are scaled back up. */
const SEARCH_WIDTH = 640
const CANNY_LOW = 30
const CANNY_HIGH = 90
const CARD_W = 842
const CARD_H = 1228
const TOP_MATCHES = 5

function toMat(cv: CV, img: RgbaImage): Mat {
  const mat = new cv.Mat(img.height, img.width, cv.CV_8UC4)
  mat.data.set(img.data)
  return mat
}

const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Orders four corners clockwise from top-left, turning a landscape card upright. */
function orderCorners(pts: Point[]): Quad {
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
  // The top edge of an upright card is a short side.
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

/**
 * The card in a frame: the largest convex four-sided outline with a card's aspect ratio
 * (upright or sideways) covering at least MIN_AREA of the frame, or null when there is none.
 */
export function findCard(cv: CV, img: RgbaImage): Quad | null {
  const scale = Math.min(1, SEARCH_WIDTH / img.width)
  const small = toMat(cv, img)
  if (scale < 1) {
    const size = new cv.Size(Math.round(img.width * scale), Math.round(img.height * scale))
    cv.resize(small, small, size, 0, 0, cv.INTER_AREA)
  }
  cv.GaussianBlur(small, small, new cv.Size(5, 5), 0)
  // Edges from each colour channel: a card can match its background in brightness but not hue.
  const channels = new cv.MatVector()
  cv.split(small, channels)
  const edges = cv.Mat.zeros(small.rows, small.cols, cv.CV_8UC1)
  const channelEdges = new cv.Mat()
  for (let c = 0; c < 3; c++) {
    const channel = channels.get(c)
    cv.Canny(channel, channelEdges, CANNY_LOW, CANNY_HIGH)
    cv.bitwise_or(edges, channelEdges, edges)
    channel.delete()
  }
  channels.delete()
  channelEdges.delete()
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U)
  cv.dilate(edges, edges, kernel)
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

  const minArea = MIN_AREA * small.rows * small.cols
  let best: Point[] | null = null
  let bestArea = 0
  const hull = new cv.Mat()
  const approx = new cv.Mat()
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i)
    // Card outlines rarely close all the way round, so judge each edge group by its hull.
    cv.convexHull(contour, hull)
    contour.delete()
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
  for (const m of [small, edges, kernel, hierarchy, hull, approx]) m.delete()
  contours.delete()
  return best && orderCorners(best)
}

/** The card inside quad, straightened to width x (width * 1228 / 842). */
export function warpCard(cv: CV, img: RgbaImage, quad: Quad, width = CARD_W): RgbaImage {
  const height = Math.round((width * CARD_H) / CARD_W)
  const src = toMat(cv, img)
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat())
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height])
  const m = cv.getPerspectiveTransform(from, to)
  const out = new cv.Mat()
  cv.warpPerspective(src, out, m, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE)
  const card = { width, height, data: new Uint8ClampedArray(out.data) }
  for (const mat of [src, from, to, m, out]) mat.delete()
  return card
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
  cv.resize(roi, small, new cv.Size(32, 32), 0, 0, cv.INTER_AREA)
  const hash = artHash({ width: 32, height: 32, data: small.data })
  roi.delete()
  small.delete()
  return hash
}

/**
 * The closest artworks to a straightened card, trying each art box (normal and Pendulum frames)
 * and keeping each image's best distance. Optionally limited to candidate image ids.
 */
export function matchArt(
  cv: CV,
  card: RgbaImage,
  index: FingerprintIndex,
  candidates?: ReadonlySet<number>
): { imageId: number; distance: number }[] {
  const mat = toMat(cv, card)
  const best = new Map<number, number>()
  for (const box of Object.values(ART_BOXES)) {
    for (const { imageId, distance } of index.nearest(
      hashBox(cv, mat, box),
      TOP_MATCHES,
      candidates
    )) {
      const prev = best.get(imageId)
      if (prev === undefined || distance < prev) best.set(imageId, distance)
    }
  }
  mat.delete()
  return [...best]
    .map(([imageId, distance]) => ({ imageId, distance }))
    .sort((a, b) => a.distance - b.distance || a.imageId - b.imageId)
    .slice(0, TOP_MATCHES)
}
