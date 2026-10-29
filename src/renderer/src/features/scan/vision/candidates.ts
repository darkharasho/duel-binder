import type { Mat } from '@techstark/opencv-js'
import type { FingerprintIndex } from '@shared/scan/fingerprintFile'
import {
  ART_BOX_JITTER,
  ART_MAX_DISTANCE,
  HOLDER_EVENNESS,
  HOLDER_CLEAR_SIDES,
  HOLDER_MAX_BORDER,
  HOLDER_MAX_CONTRAST,
  HOLDER_MIN_BORDER,
  NEST_MIN_END_INSET,
  NEST_MIN_GROWTH
} from '@shared/scan/thresholds'
import { SCAN_PROFILES, type ScanProfile } from '@shared/scan/profiles'
import type { RgbaImage } from '@shared/scan/types'
import type { CV } from './cv'
import {
  CARD_W,
  MIN_AREA,
  SEARCH_WIDTH,
  dist,
  edgeMap,
  frameWidth,
  orderCorners,
  outlineQuad,
  rankArt,
  rotate180,
  searchImage,
  thicken,
  using,
  warpCard,
  withMat,
  type FrameSource,
  type Point,
  type Quad
} from './detect'
import { INNER_FRAME, type Box } from './regions'

// Tuned on real webcam photos: cards held in hand, sleeved, foil or in toploaders, fingers over the
// edges, a deck under the card and a wood-grain desk behind. A held card's outline seldom closes,
// so it is rebuilt from straight edge lines, and the card's own art window tells it apart from the
// deck behind it. Lines are looked for twice: in all edges, and in edges split by direction, which
// keeps busy artwork from drowning out the art window's and the card's borders.
/** HoughLinesP: vote threshold, shortest segment (share of the search width) and largest gap. */
const HOUGH_VOTES = 50
const HOUGH_MIN_LENGTH = 0.1
const HOUGH_MAX_GAP = 10
/** Edge directions are split into this many groups, each taking edges this close to its direction. */
const DIRECTIONS = 4
const DIRECTION_SPREAD = (30 * Math.PI) / 180
/** Segments within this angle and offset are one line. */
const MERGE_ANGLE = (2 * Math.PI) / 180
const MERGE_OFFSET = 2.5
/** Longest lines kept for building quads. */
const MAX_LINES = 80
/** Opposite sides are this close to parallel, adjacent sides this close to square. */
const PARALLEL = (5 * Math.PI) / 180
const SQUARE = (11 * Math.PI) / 180
/** Opposite sides are at least this far apart, as a share of the search height. */
const MIN_SEPARATION = 0.08
/** Short side over long side of a card, and how far off a candidate may be. */
const CARD_ASPECT = 0.69
const ASPECT_TOLERANCE = 0.06
/** Corners may lie this far outside the frame, as a share of its size. */
const FRAME_MARGIN = 0.02
/** Share of each side that must lie on edges. */
const MIN_SIDE_COVER = 0.45
/** Weight of the art window's border in a candidate's score; the rest is the outline's. */
const ART_WEIGHT = 0.5
/** Points sampled along a side to measure its edge coverage. */
const COVER_SAMPLES = 60
/** Candidates whose corners are all within this share of the diagonal are one. */
const SAME_QUAD = 0.015
/** Candidates kept from the direction-split lines and, besides those, from all edges' lines. */
const SPLIT_CANDIDATES = 8
const PLAIN_CANDIDATES = 3
/**
 * preferOuter: an outer candidate may be at most this many times the first one's area (a card
 * is about 1.5x its art-plus-text box), and the first one's corners may lie this far outside it,
 * as a share of its diagonal.
 */
const NEST_MAX_GROWTH = 1.6
const NEST_TOLERANCE = 0.02
/** Points sampled along each side of a holder's border, and how far outside it the desk is read. */
const BORDER_SAMPLES = 9
const BORDER_OUTSIDE = 0.02
/** Width candidates are straightened to for choosing between them. */
const PICK_WIDTH = 210

interface Line {
  theta: number
  rho: number
  length: number
  nx: number
  ny: number
}

type Segment = readonly [number, number, number, number]

/** Angle between two line directions, in [0, pi/2]. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI
  return Math.min(d, Math.PI - d)
}

/** Direction of a segment, in [0, pi). */
function direction([x1, y1, x2, y2]: Segment): number {
  const theta = Math.atan2(y2 - y1, x2 - x1)
  return theta < 0 ? theta + Math.PI : theta >= Math.PI ? theta - Math.PI : theta
}

/** HoughLinesP segments in a binary map. */
function segments(cv: CV, map: Mat): Segment[] {
  const found = new cv.Mat()
  return using([found], () => {
    cv.HoughLinesP(
      map,
      found,
      1,
      Math.PI / 180,
      HOUGH_VOTES,
      Math.round(HOUGH_MIN_LENGTH * map.cols),
      HOUGH_MAX_GAP
    )
    const s = found.data32S
    return Array.from({ length: found.rows }, (_, i) => s.subarray(i * 4, i * 4 + 4)).map(
      ([x1, y1, x2, y2]) => [x1, y1, x2, y2] as const
    )
  })
}

/**
 * Segments found separately among edges of each direction group, judging an edge pixel's
 * direction by the colour channel that changes most across it.
 */
function splitSegments(cv: CV, small: Mat, edges: Mat): Segment[] {
  const n = edges.rows * edges.cols
  const gx: Int16Array[] = []
  const gy: Int16Array[] = []
  const channels = new cv.MatVector()
  const gradient = new cv.Mat()
  using([channels, gradient], () => {
    cv.split(small, channels)
    for (let c = 0; c < 3; c++) {
      const channel = channels.get(c)
      try {
        cv.Sobel(channel, gradient, cv.CV_16S, 1, 0)
        gx.push(gradient.data16S.slice())
        cv.Sobel(channel, gradient, cv.CV_16S, 0, 1)
        gy.push(gradient.data16S.slice())
      } finally {
        channel.delete()
      }
    }
  })
  const groups = Array.from({ length: DIRECTIONS }, () => new Uint8Array(n))
  const centre = (g: number): number => (g * Math.PI) / DIRECTIONS
  const e = edges.data
  for (let i = 0; i < n; i++) {
    if (!e[i]) continue
    let strongest = -1
    let dx = 0
    let dy = 0
    for (let c = 0; c < 3; c++) {
      const m = gx[c][i] * gx[c][i] + gy[c][i] * gy[c][i]
      if (m > strongest) {
        strongest = m
        dx = gx[c][i]
        dy = gy[c][i]
      }
    }
    // The edge runs across its gradient.
    const theta = (Math.atan2(dy, dx) + (3 * Math.PI) / 2) % Math.PI
    for (let g = 0; g < DIRECTIONS; g++)
      if (angleBetween(theta, centre(g)) <= DIRECTION_SPREAD) groups[g][i] = 255
  }
  const map = new cv.Mat(edges.rows, edges.cols, cv.CV_8UC1)
  return using([map], () =>
    groups.flatMap((group, g) => {
      map.data.set(group)
      return segments(cv, map).filter(
        (s) => angleBetween(direction(s), centre(g)) <= DIRECTION_SPREAD
      )
    })
  )
}

/** Straight edge lines, longest first, from segments merged when collinear. */
function mergeLines(segs: Segment[]): Line[] {
  const lines: Line[] = []
  for (const s of segs) {
    const theta = direction(s)
    const mx = (s[0] + s[2]) / 2
    const my = (s[1] + s[3]) / 2
    const length = Math.hypot(s[2] - s[0], s[3] - s[1])
    const same = lines.find(
      (l) =>
        angleBetween(l.theta, theta) <= MERGE_ANGLE &&
        Math.abs(mx * l.nx + my * l.ny - l.rho) <= MERGE_OFFSET
    )
    if (same) {
      same.length += length
      continue
    }
    const nx = -Math.sin(theta)
    const ny = Math.cos(theta)
    lines.push({ theta, rho: mx * nx + my * ny, length, nx, ny })
  }
  return lines.sort((a, b) => b.length - a.length).slice(0, MAX_LINES)
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.nx * b.ny - a.ny * b.nx
  if (Math.abs(det) < 1e-6) return null
  return [(a.rho * b.ny - b.rho * a.ny) / det, (a.nx * b.rho - b.nx * a.rho) / det]
}

/** The homography taking the unit square's corners onto quad's, row-major with its last entry 1. */
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
  // Gauss-Jordan elimination with partial pivoting.
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

const project = (h: number[], x: number, y: number): Point => {
  const d = h[6] * x + h[7] * y + h[8]
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d]
}

/** Maps a point of the unit square onto quad (corner i of the square goes to quad[i]). */
function homography(quad: Quad): (u: number, v: number) => Point {
  const h = squareTo(quad)
  return (u, v) => project(h, u, v)
}

/** Maps a point of the frame into quad's unit square: homography's inverse. */
function intoSquare(quad: Quad): (x: number, y: number) => Point {
  const [a, b, c, d, e, f, g, h, i] = squareTo(quad)
  // The adjugate is the inverse up to scale, which a homography ignores.
  const inv = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d
  ]
  return (x, y) => project(inv, x, y)
}

/**
 * The gap between outer's sides and inner's, in outer's widths (its short side), on each of its
 * four sides: inner's corners measured in outer's own straightened frame, so a slanted view of
 * the two doesn't skew it. Negative where inner pokes out.
 */
function insets(outer: Quad, inner: Quad): number[] {
  const at = intoSquare(outer)
  const pts = inner.map(([x, y]) => at(x, y))
  const us = pts.map((p) => p[0])
  const vs = pts.map((p) => p[1])
  // orderCorners puts a short side first: u runs across the width, v along the length.
  const length =
    (dist(outer[1], outer[2]) + dist(outer[3], outer[0])) /
    (dist(outer[0], outer[1]) + dist(outer[2], outer[3]) || 1)
  return [
    Math.min(...us),
    1 - Math.max(...us),
    Math.min(...vs) * length,
    (1 - Math.max(...vs)) * length
  ]
}

/** An RGB pixel of the frame at full-frame coordinates (x, y), clamped to its edges. */
type Sampler = (x: number, y: number) => readonly [number, number, number]

/** A Sampler reading an RGBA image shrunk by scale. */
function sampler(img: Mat, scale: number): Sampler {
  const { cols, rows } = img
  const d = img.data
  return (x, y) => {
    const xi = Math.min(cols - 1, Math.max(0, Math.round(x * scale)))
    const yi = Math.min(rows - 1, Math.max(0, Math.round(y * scale)))
    const i = (yi * cols + xi) * 4
    return [d[i], d[i + 1], d[i + 2]]
  }
}

/**
 * For each side (as insets orders them), how far the band between outer and inner differs in
 * colour from what lies just outside outer: the median over points along the side of the mean
 * absolute difference per channel. A clear case's border shows the desk or hand behind it, as
 * outside it does; a card's printed frame round its inner boxes is its own colour.
 */
function borderContrast(pixel: Sampler, outer: Quad, inner: Quad): number[] {
  const at = homography(outer)
  const gaps = insets(outer, inner)
  // Insets are in outer's widths; v runs along its length.
  const length =
    (dist(outer[1], outer[2]) + dist(outer[3], outer[0])) /
    (dist(outer[0], outer[1]) + dist(outer[2], outer[3]) || 1)
  const sides: ((t: number, w: number) => Point)[] = [
    (t, w) => at(w, t),
    (t, w) => at(1 - w, t),
    (t, w) => at(t, w / length),
    (t, w) => at(t, 1 - w / length)
  ]
  return gaps.map((gap, k) => {
    const diffs: number[] = []
    for (let i = 0; i < BORDER_SAMPLES; i++) {
      const t = 0.15 + (0.7 * (i + 0.5)) / BORDER_SAMPLES
      const a = pixel(...sides[k](t, gap / 2))
      const b = pixel(...sides[k](t, -gap / 2 - BORDER_OUTSIDE))
      diffs.push((Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3)
    }
    diffs.sort((x, y) => x - y)
    return diffs[diffs.length >> 1]
  })
}

/**
 * Whether outer is a case (or toploader) holding the card inner: a border of even width all
 * round (insets), see-through on at least HOLDER_CLEAR_SIDES sides (borderContrast). A card's own
 * inner frames sit about four times deeper below its top than above its bottom, and the card's
 * printed frame round them is its own colour, so the card isn't taken for their holder.
 */
function holds(outer: Quad, inner: Quad, pixel: Sampler): boolean {
  const gaps = insets(outer, inner)
  const least = Math.min(...gaps)
  const most = Math.max(...gaps)
  if (
    least < HOLDER_MIN_BORDER ||
    most > HOLDER_MAX_BORDER ||
    most > HOLDER_EVENNESS * least ||
    !cardShaped(inner)
  )
    return false
  const clear = borderContrast(pixel, outer, inner).filter((d) => d <= HOLDER_MAX_CONTRAST)
  return clear.length >= HOLDER_CLEAR_SIDES
}

/**
 * quads with every one that holds a later one (holds) moved to just after the last card it
 * holds: the outline finder's pick is often a case's crisp, closed rim rather than the card in it.
 */
function cardsBeforeHolders(quads: readonly Quad[], pixel: Sampler): Quad[] {
  const out = [...quads]
  for (let i = 0; i < out.length; i++) {
    let last = -1
    for (let j = i + 1; j < out.length; j++) if (holds(out[i], out[j], pixel)) last = j
    if (last < 0) continue
    // Holding is strict nesting, so a holder only ever moves later and this ends.
    const [holder] = out.splice(i, 1)
    out.splice(last, 0, holder)
    i--
  }
  return out
}

const sameQuad = (a: Quad, b: Quad): boolean =>
  a.every((p, i) => dist(p, b[i]) < SAME_QUAD * dist(b[0], b[2]))

/**
 * Up to max card outlines built from lines, best first: two pairs of near-parallel lines at right
 * angles, with a card's aspect ratio and edges along every side, scored by how much of their
 * outline and of their art window's border lies on the thickened edges.
 */
function lineQuads(lines: Line[], thick: Mat, max: number, windows: readonly Box[]): Quad[] {
  const w = thick.cols
  const h = thick.rows
  const td = thick.data
  const onEdge = (x: number, y: number): number => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    return xi >= 0 && yi >= 0 && xi < w && yi < h && td[yi * w + xi] ? 1 : 0
  }
  const cover = (a: Point, b: Point): number => {
    let c = 0
    for (let i = 0; i < COVER_SAMPLES; i++) {
      const t = (i + 0.5) / COVER_SAMPLES
      c += onEdge(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    }
    return c / COVER_SAMPLES
  }
  const sideCover = (q: readonly Point[]): number[] =>
    [0, 1, 2, 3].map((i) => cover(q[i], q[(i + 1) % 4]))
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

  const pairs: [Line, Line][] = []
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const [a, b] = [lines[i], lines[j]]
      if (angleBetween(a.theta, b.theta) > PARALLEL) continue
      // b's offset measured along a's normal.
      const separation = Math.abs(b.rho * (b.nx * a.nx + b.ny * a.ny) - a.rho)
      if (separation < MIN_SEPARATION * h || separation > h) continue
      pairs.push([a, b])
    }
  }

  const found: { quad: Quad; score: number }[] = []
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, a2] = pairs[i]
      const [b1, b2] = pairs[j]
      if (Math.abs(angleBetween(a1.theta, b1.theta) - Math.PI / 2) > SQUARE) continue
      const corners = [intersect(a1, b1), intersect(b1, a2), intersect(a2, b2), intersect(b2, a1)]
      if (corners.some((p) => !p)) continue
      const q = orderCorners(corners as Point[])
      const [mx, my] = [FRAME_MARGIN * w, FRAME_MARGIN * h]
      if (q.some(([x, y]) => x < -mx || y < -my || x > w + mx || y > h + my)) continue
      const sideA = (dist(q[0], q[1]) + dist(q[2], q[3])) / 2
      const sideB = (dist(q[1], q[2]) + dist(q[3], q[0])) / 2
      const aspect = Math.min(sideA, sideB) / Math.max(sideA, sideB)
      if (Math.abs(aspect - CARD_ASPECT) > ASPECT_TOLERANCE) continue
      if (sideA * sideB < MIN_AREA * w * h) continue
      const sides = sideCover(q)
      if (Math.min(...sides) < MIN_SIDE_COVER) continue
      // The art window's border, either way up and for each of the game's frames.
      const at = homography(q)
      let art = 0
      for (const b of windows) {
        for (const box of [b, [1 - b[2], 1 - b[3], 1 - b[0], 1 - b[1]]]) {
          const window = [
            at(box[0], box[1]),
            at(box[2], box[1]),
            at(box[2], box[3]),
            at(box[0], box[3])
          ]
          art = Math.max(art, mean(sideCover(window)))
        }
      }
      found.push({ quad: q, score: (1 - ART_WEIGHT) * mean(sides) + ART_WEIGHT * art })
    }
  }

  found.sort((a, b) => b.score - a.score)
  const kept: Quad[] = []
  for (const { quad } of found) {
    if (kept.length >= max) break
    if (!kept.some((k) => sameQuad(quad, k))) kept.push(quad)
  }
  return kept
}

/**
 * Card outlines in a frame, likeliest first: the outline finder's pick (findCard), then quads
 * built from the lines in edges split by direction, then any more from the lines in all edges,
 * those scored by profile's art windows.
 */
export function findCandidates(
  cv: CV,
  img: FrameSource,
  profile: ScanProfile = SCAN_PROFILES.ygo
): Quad[] {
  const scale = Math.min(1, SEARCH_WIDTH / frameWidth(img))
  const small = searchImage(cv, img, scale)
  return using([small], () => {
    const edges = edgeMap(cv, small)
    return using([edges], () => {
      const thick = thicken(cv, edges)
      return using([thick], () => {
        const split = lineQuads(
          mergeLines(splitSegments(cv, small, edges)),
          thick,
          SPLIT_CANDIDATES,
          profile.windows
        )
        const plain = lineQuads(
          mergeLines(segments(cv, edges)),
          thick,
          PLAIN_CANDIDATES + split.length,
          profile.windows
        )
          .filter((q) => !split.some((k) => sameQuad(q, k)))
          .slice(0, PLAIN_CANDIDATES)
        const outline = outlineQuad(cv, thick, scale)
        const quads = [...split, ...plain].map(
          (q) => q.map(([x, y]) => [x / scale, y / scale]) as unknown as Quad
        )
        return cardsBeforeHolders(
          outline ? [outline, ...quads.filter((q) => !sameQuad(q, outline))] : quads,
          sampler(small, scale)
        )
      })
    })
  })
}

/** Twice the quad's signed area; its sign is the way the corners wind. */
const signedArea2 = (q: Quad): number =>
  q.reduce((s, [x, y], i) => s + x * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * y, 0)
const area = (q: Quad): number => Math.abs(signedArea2(q)) / 2

/** Short side over long side, averaging opposite sides, is a card's. */
const cardShaped = (q: Quad): boolean => {
  const a = (dist(q[0], q[1]) + dist(q[2], q[3])) / 2
  const b = (dist(q[1], q[2]) + dist(q[3], q[0])) / 2
  return Math.abs(Math.min(a, b) / Math.max(a, b) - CARD_ASPECT) <= ASPECT_TOLERANCE
}

/** Every corner of inner lies inside the convex quad outer, or within tol of its sides. */
function contains(outer: Quad, inner: Quad, tol: number): boolean {
  // Which side of each edge is inside depends on the way outer winds.
  const turn = Math.sign(signedArea2(outer))
  return inner.every(([px, py]) =>
    outer.every(([ax, ay], i) => {
      const [bx, by] = outer[(i + 1) % 4]
      const len = Math.hypot(bx - ax, by - ay) || 1
      // Signed distance from the edge, positive inside.
      return (turn * ((bx - ax) * (py - ay) - (by - ay) * (px - ax))) / len >= -tol
    })
  )
}

/**
 * The first candidate, unless a later card-shaped one holds it whole, is at most NEST_MAX_GROWTH
 * times its area, and either is at least NEST_MIN_GROWTH times it or sits NEST_MIN_END_INSET
 * beyond it at one end: then the largest such one. A card's own inner frames (the art
 * box, or the art and text boxes together) have crisp printed edges, while fingers over a held
 * card's sides cost its outline edge cover, so the inner frame can rank first. A sleeve around
 * the card is card-shaped too, but too close to the card's size, and to its ends, to be taken
 * for it.
 */
/**
 * How far inner sits inside outer from outer's nearer short side, as a share of outer's length:
 * the larger of its insets from either end, since the card may be upside down.
 */
function endInset(outer: Quad, inner: Quad): number {
  const [p0, p1, p2, p3] = outer
  // The short sides are the ends.
  const ends: [Point, Point, Point, Point] =
    dist(p0, p1) + dist(p2, p3) <= dist(p1, p2) + dist(p3, p0) ? [p0, p1, p2, p3] : [p1, p2, p3, p0]
  const fromLine = ([ax, ay]: Point, [bx, by]: Point, [px, py]: Point): number =>
    Math.abs((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / (Math.hypot(bx - ax, by - ay) || 1)
  const length = (fromLine(ends[0], ends[1], ends[2]) + fromLine(ends[0], ends[1], ends[3])) / 2
  const top = Math.min(...inner.map((p) => fromLine(ends[0], ends[1], p)))
  const bottom = Math.min(...inner.map((p) => fromLine(ends[2], ends[3], p)))
  return Math.max(top, bottom) / (length || 1)
}

export function preferOuter(quads: readonly Quad[]): Quad | null {
  const [first] = quads
  if (!first) return null
  const tol = NEST_TOLERANCE * dist(first[0], first[2])
  const least = NEST_MIN_GROWTH * area(first)
  const limit = NEST_MAX_GROWTH * area(first)
  let best = first
  for (const q of quads.slice(1)) {
    const a = area(q)
    // A sleeve hugs the card at its ends; a frame inside the card starts well below its top.
    const grown = a <= limit && (a >= least || endInset(q, first) >= NEST_MIN_END_INSET)
    if (a > area(best) && grown && cardShaped(q) && contains(q, first, tol)) best = q
  }
  return best
}

/**
 * The card's outline were quad its inner frame (INNER_FRAME), either way up: a black
 * (Xyz) card's edge barely shows against a dark desk, palm or sleeve, so its outline may not be
 * among the candidates while its inner frame is.
 */
function aroundInnerFrame(quad: Quad): Quad[] {
  const at = homography(quad)
  const [x0, y0, x1, y1] = INNER_FRAME
  const ways: Box[] = [INNER_FRAME, [1 - x1, 1 - y1, 1 - x0, 1 - y0]]
  return ways.map(([a, b, c, d]) => {
    // The card's corners in the inner frame's unit square.
    const u0 = -a / (c - a)
    const u1 = (1 - a) / (c - a)
    const v0 = -b / (d - b)
    const v1 = (1 - b) / (d - b)
    return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)] as const
  })
}

/**
 * The card in a frame and its closest artworks: each candidate outline is matched on a small
 * straightened copy, and the one closest to any artwork is straightened at full size and matched
 * again. When none is close enough to accept, the card around each candidate taken for its inner
 * frame is tried too. card is that 842x1228 straightened card, turned the way up its art matched so the name
 * and code read, and matches its k closest artworks (rankArt's default when k is left out). When
 * even then none is close enough, the closest says nothing of where the card is or which way up
 * (its artwork may be missing from the fingerprints, as a new alternate art is): quad and card are
 * then the outline finder's likeliest (preferOuter), as it was filmed, and upsideDown is null. Null
 * when the frame holds no card-shaped outline. The art is looked for in profile's art boxes.
 */
export function recognizeArt(
  cv: CV,
  img: FrameSource,
  index: FingerprintIndex,
  candidates?: ReadonlySet<number>,
  k?: number,
  profile: ScanProfile = SCAN_PROFILES.ygo
): {
  quad: Quad
  card: RgbaImage
  upsideDown: boolean | null
  matches: { imageId: number; distance: number }[]
} | null {
  // Copied into OpenCV once for all the candidates' warps.
  return withMat(cv, img, (frame) => {
    const closest = (quads: Quad[]): { quad: Quad; distance: number } | null => {
      let best: { quad: Quad; distance: number } | null = null
      for (const quad of quads) {
        const { matches } = rankArt(
          cv,
          warpCard(cv, frame, quad, PICK_WIDTH),
          index,
          candidates,
          undefined,
          0,
          profile
        )
        const distance = matches[0]?.distance ?? Infinity
        if (!best || distance < best.distance) best = { quad, distance }
      }
      return best
    }
    const quads = findCandidates(cv, frame, profile)
    let best = closest(quads)
    if (!best) return null
    // No candidate matched: one may be a black card's inner frame rather than the card.
    if (best.distance > ART_MAX_DISTANCE) {
      const around = closest(quads.flatMap(aroundInnerFrame))
      if (around && around.distance < best.distance) best = around
    }
    const card = warpCard(cv, frame, best.quad, CARD_W)
    const { matches, upsideDown } = rankArt(cv, card, index, candidates, k, ART_BOX_JITTER, profile)
    if ((matches[0]?.distance ?? Infinity) > ART_MAX_DISTANCE) {
      const outline = preferOuter(quads) ?? best.quad
      return {
        quad: outline,
        card: warpCard(cv, frame, outline, CARD_W),
        upsideDown: null,
        matches
      }
    }
    return { quad: best.quad, card: upsideDown ? rotate180(card) : card, upsideDown, matches }
  })
}
