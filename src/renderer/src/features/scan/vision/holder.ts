// Whether a card is in a graded slab (PSA, BGS, CGC...): a slab carries a white label block with
// printed text above the card, inside a wider clear holder (TAG's label is clear instead, found by
// its white frame: labelFrameAbove). A toploader or a magnetic case has no
// label, so it reads as a bare card. Only the strips round the label are sampled, never the whole
// frame, so it's cheap enough for every frame.
import {
  SLAB_INK_DARKER_BY,
  SLAB_LABEL_MIN_BRIGHT,
  SLAB_LABEL_MIN_PAPER_SHARE,
  SLAB_LABEL_LIFTS,
  SLAB_LABEL_U,
  SLAB_LABEL_V,
  SLAB_MIN_CONTRAST,
  SLAB_MIN_CONTRAST_ALL,
  SLAB_MIN_CONTRAST_SIDES,
  SLAB_TEXT_MIN_FLIPS
} from '@shared/scan/thresholds'
import type { Mat } from '@techstark/opencv-js'
import type { CV } from './cv'
import type { Point, Quad } from './detect'

const COLS = 40
const ROWS = 8

interface Samples {
  luma: number[]
  /** Grid points that fell outside the frame. */
  missed: number
}

/** The luma at a grid of points over the box [u0,u1] x [v0,v1] of the card at corners p. */
function sample(frame: Mat, p: Quad, box: readonly number[], cols: number, rows: number): Samples {
  const { cols: w, rows: h } = frame
  const data = frame.data
  const [u0, u1, v0, v1] = box
  const across: Point = [p[1][0] - p[0][0], p[1][1] - p[0][1]]
  const down: Point = [p[3][0] - p[0][0], p[3][1] - p[0][1]]
  const luma: number[] = []
  let missed = 0
  for (let j = 0; j < rows; j++) {
    const v = v0 + ((v1 - v0) * (j + 0.5)) / rows
    for (let i = 0; i < cols; i++) {
      const u = u0 + ((u1 - u0) * (i + 0.5)) / cols
      const x = Math.round(p[0][0] + u * across[0] + v * down[0])
      const y = Math.round(p[0][1] + u * across[1] + v * down[1])
      if (x < 0 || y < 0 || x >= w || y >= h) {
        missed++
        continue
      }
      const k = (y * w + x) * 4
      luma.push(0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2])
    }
  }
  return { luma, missed }
}

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length

/** How often a row of luma (cols across) crosses below or back above `ink`, summed over rows. */
function flips(luma: number[], cols: number, ink: number): number {
  let n = 0
  for (let i = 1; i < luma.length; i++)
    if (i % cols !== 0 && luma[i] < ink !== luma[i - 1] < ink) n++
  return n
}

/**
 * Where a label block shows above the card whose corners (clockwise from top-left) are p: the
 * label window's [v0, v1] (in the card's heights, negative above it), or null when none does. The
 * window is tried at a few heights: a smaller card (Yu-Gi-Oh!'s) sits lower in the same case, its
 * label further above it.
 */
function labelAbove(frame: Mat, p: Quad): readonly [number, number] | null {
  for (const lift of SLAB_LABEL_LIFTS) {
    const v: readonly [number, number] = [SLAB_LABEL_V[0] - lift, SLAB_LABEL_V[1] - lift]
    if (labelAt(frame, p, v)) return v
  }
  return null
}

/** What the slab check measures of the window v (as SLAB_LABEL_V) above the card at p. */
export interface LabelMeasure {
  /** Share of the window's grid points that fell outside the frame. */
  missed: number
  /** Share of the window bright enough to be label paper. */
  paperShare: number
  paperLuma: number
  /** Ink crossings along the window's rows. */
  flips: number
  /** Paper's luma less the mean of left, right and above it (null where a side is off-frame). */
  contrast: number[] | null
}

export function labelMeasure(frame: Mat, p: Quad, v: readonly [number, number]): LabelMeasure {
  const label = sample(frame, p, [...SLAB_LABEL_U, ...v], COLS, ROWS)
  const paper = label.luma.filter((l) => l >= SLAB_LABEL_MIN_BRIGHT)
  const paperLuma = paper.length ? mean(paper) : 0
  const [v0, v1] = v
  const [u0, u1] = SLAB_LABEL_U
  const around = [
    sample(frame, p, [u0 - 0.2, u0 - 0.08, v0, v1], 3, ROWS),
    sample(frame, p, [u1 + 0.08, u1 + 0.2, v0, v1], 3, ROWS),
    sample(frame, p, [u0, u1, v0 - 0.12, v0 - 0.04], COLS, 3)
  ]
  return {
    missed: label.missed / (COLS * ROWS),
    paperShare: label.luma.length ? paper.length / label.luma.length : 0,
    paperLuma,
    flips: paper.length ? flips(label.luma, COLS, paperLuma - SLAB_INK_DARKER_BY) : 0,
    contrast: around.some((s) => s.luma.length === 0)
      ? null
      : around.map((s) => paperLuma - mean(s.luma))
  }
}

/** Whether the label block fills the window v (as SLAB_LABEL_V) above the card at p. */
function labelAt(frame: Mat, p: Quad, v: readonly [number, number]): boolean {
  const m = labelMeasure(frame, p, v)
  if (m.missed > 0.2) return false
  if (m.paperShare < SLAB_LABEL_MIN_PAPER_SHARE) return false
  if (m.flips < SLAB_TEXT_MIN_FLIPS) return false
  // The holder beside the label and the strip above it are plastic over the desk, not paper. Two
  // of the three clearly darker, and all somewhat darker: on a light wooden desk the strip above
  // the label is only a little darker.
  const contrast = m.contrast
  if (!contrast) return false
  return (
    contrast.every((c) => c > SLAB_MIN_CONTRAST_ALL) &&
    contrast.filter((c) => c >= SLAB_MIN_CONTRAST).length >= SLAB_MIN_CONTRAST_SIDES
  )
}

/**
 * Whether the card at quad (in frame's pixels) sits in a graded slab: a bright label block with
 * text above it (or below it, for a card read upside down), set in clear plastic. Sized by the
 * card's own width and height, so it holds at any distance. When unsure, false: a wrong "slab"
 * only adds a Raw tag, but neither answer changes which card is named.
 */
export function isSlab(_cv: CV, frame: Mat, quad: Quad): boolean {
  return slabQuad(frame, quad) !== null
}

/** A card found in a slab: its corners turned so the label is above, and where the label is. */
export interface SlabFound {
  quad: Quad
  /** The label window found, [v0, v1] in the card's heights above its top edge (negative). */
  labelV: readonly [number, number]
}

/**
 * The card's corners turned so the slab's label is above its top edge (quad itself, or turned
 * half a turn), with where the label was found; null when the card isn't in a slab. A white paper
 * label is looked for both ways up; then a clear label's frame (TAG's), above the card's printed
 * top when `upsideDown` says which way up it is (art matching), else both ways.
 */
export function slabQuad(
  frame: Mat,
  quad: Quad,
  upsideDown: boolean | null = null
): SlabFound | null {
  const up = labelAbove(frame, quad)
  if (up) return { quad, labelV: up }
  // The same card turned half a turn: its bottom edge is the top.
  const turned: Quad = [quad[2], quad[3], quad[0], quad[1]]
  const down = labelAbove(frame, turned)
  if (down) return { quad: turned, labelV: down }
  for (const q of upsideDown === null ? [quad, turned] : [upsideDown ? turned : quad]) {
    const framed = labelFrameAbove(frame, q)
    if (framed) return { quad: q, labelV: framed }
  }
  return null
}

// A TAG slab's label is clear plastic printed white, so it takes the colour of whatever is behind
// the case (a wooden desk, a dark room): the paper check above never finds it. What it does show
// on any background is its thin white frame, a box about as wide as the card above it. Found by
// its lines: two across (the label's top and bottom) a label's height apart, and a straight one
// down each side between them.

/** What the label-frame check looks for (see TAG_FRAME). */
export interface FrameRule {
  /** A line sample is at least this much brighter (luma) than both samples `gap` either side. */
  ridge: number
  /** Either side of a line, in the card's heights (lines across) or widths (lines down). */
  gap: number
  /** The bottom line across lights at least this share of its columns... */
  bottomAcross: number
  /** ...and the top one this share (TAG's plaque breaks it in the middle). */
  topAcross: number
  /** The label's height, top line to bottom line, in the card's heights. */
  height: readonly [number, number]
  /** Where the label's bottom line may sit above the card's top edge, in the card's heights. */
  bottom: readonly [number, number]
  /** Each side line lights at least this share of the rows between the lines across... */
  side: number
  /** ...within this much (card widths) of one place across: a line, not a busy background... */
  sideSpread: number
  /**
   * ...and that place within these spans across (card widths): TAG's label is about the card's
   * own width, so its sides sit at the card's edges. The card's own frame lines, when the outline
   * found is an inner frame, sit further in; a stand's or case's rim, further out.
   */
  left: readonly [number, number]
  right: readonly [number, number]
}

/**
 * Tuned on 2026-11-19 live TAG frames (a dark room) and two TAG photos (a wooden desk), against
 * ~1,100 bare/toploader photos (8 taken as slabs with orientation unknown, most below the card)
 * and ~1,400 live trace frames (none a card taken as a slab). It costs about 2.5 ms a way.
 */
export const TAG_FRAME: FrameRule = {
  ridge: 20,
  gap: 0.012,
  bottomAcross: 0.55,
  topAcross: 0.4,
  height: [0.18, 0.36],
  bottom: [-0.3, -0.01],
  side: 0.6,
  sideSpread: 0.02,
  left: [-0.075, 0.04],
  right: [0.94, 1.06]
}

const FRAME_COLS = 48
const FRAME_STEP = 0.003
const FRAME_TOP = -0.75

/** The luma at the card's (u, v), or NaN off the frame. */
function lumaAt(frame: Mat, p: Quad, u: number, v: number): number {
  const x = Math.round(p[0][0] + u * (p[1][0] - p[0][0]) + v * (p[3][0] - p[0][0]))
  const y = Math.round(p[0][1] + u * (p[1][1] - p[0][1]) + v * (p[3][1] - p[0][1]))
  if (x < 0 || y < 0 || x >= frame.cols || y >= frame.rows) return NaN
  const k = (y * frame.cols + x) * 4
  const d = frame.data
  return 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]
}

/**
 * Where a TAG-style label frame shows above the card at p: its [top, bottom] in the card's heights
 * (negative, above the card), or null. Rows are sampled every FRAME_STEP; a line across is a row
 * (give or take a step, for a slight tilt) where most columns are a thin bright ridge.
 */
export function labelFrameAbove(
  frame: Mat,
  p: Quad,
  rule: FrameRule = TAG_FRAME
): readonly [number, number] | null {
  const n = Math.round(-FRAME_TOP / FRAME_STEP)
  const vAt = (k: number): number => FRAME_TOP + k * FRAME_STEP
  const reach = Math.max(1, Math.round(rule.gap / FRAME_STEP))
  const luma: Float32Array[] = []
  for (let k = 0; k < n + reach; k++) {
    const row = new Float32Array(FRAME_COLS)
    for (let i = 0; i < FRAME_COLS; i++)
      row[i] = lumaAt(frame, p, 0.1 + (0.8 * (i + 0.5)) / FRAME_COLS, vAt(k))
    luma.push(row)
  }
  // ridge[k][i]: row k, column i is on a thin bright line across.
  const ridge: Uint8Array[] = []
  for (let k = 0; k < n; k++) {
    const row = new Uint8Array(FRAME_COLS)
    if (k >= reach)
      for (let i = 0; i < FRAME_COLS; i++)
        if (luma[k][i] - Math.max(luma[k - reach][i], luma[k + reach][i]) >= rule.ridge) row[i] = 1
    ridge.push(row)
  }
  const share: number[] = []
  for (let k = 0; k < n; k++) {
    let lit = 0
    for (let i = 0; i < FRAME_COLS; i++)
      if (ridge[k][i] || ridge[k - 1]?.[i] || ridge[k + 1]?.[i]) lit++
    share.push(lit / FRAME_COLS)
  }
  // Lines across: the best row of each run over the lower share.
  const lines: number[] = []
  for (let k = 0; k < n; k++) {
    if (share[k] < rule.topAcross) continue
    if (share[k] < (share[k - 1] ?? 0) || share[k] < (share[k + 1] ?? 0)) continue
    if (lines.length && k - lines[lines.length - 1] <= 3) continue
    lines.push(k)
  }
  // The pair nearest the card wins: the lowest bottom line, then the nearest top line over it.
  for (let b = lines.length - 1; b >= 0; b--) {
    const bottom = vAt(lines[b])
    if (share[lines[b]] < rule.bottomAcross) continue
    if (bottom < rule.bottom[0] || bottom > rule.bottom[1]) continue
    for (let t = b - 1; t >= 0; t--) {
      const top = vAt(lines[t])
      const h = bottom - top
      if (h < rule.height[0]) continue
      if (h > rule.height[1]) break
      if (sidesBetween(frame, p, top, bottom, rule)) return [top, bottom]
    }
  }
  return null
}

/** Whether a straight thin bright line runs down each side of the label, top to bottom. */
function sidesBetween(frame: Mat, p: Quad, top: number, bottom: number, rule: FrameRule): boolean {
  const ROWS = 12
  const STEP = 0.004
  const g = rule.gap
  for (const [s0, s1] of [rule.left, rule.right]) {
    // Where each row has a ridge down, then whether one place across holds enough rows.
    const hits: number[] = []
    for (let j = 0; j < ROWS; j++) {
      const v = top + (bottom - top) * (0.15 + (0.7 * (j + 0.5)) / ROWS)
      for (let u = s0; u <= s1; u += STEP) {
        const c = lumaAt(frame, p, u, v)
        if (c - Math.max(lumaAt(frame, p, u - g, v), lumaAt(frame, p, u + g, v)) >= rule.ridge)
          hits.push(u)
      }
    }
    let best = 0
    for (const at of hits) {
      const near = hits.filter((u) => Math.abs(u - at) <= rule.sideSpread / 2).length
      if (near > best) best = near
    }
    if (best / ROWS < rule.side) return false
  }
  return true
}
