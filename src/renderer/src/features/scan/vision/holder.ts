// Whether a card is in a graded slab (PSA, BGS, CGC...): a slab carries a white label block with
// printed text above the card, inside a wider clear holder. A toploader or a magnetic case has no
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
 * half a turn), with where the label was found; null when the card isn't in a slab.
 */
export function slabQuad(frame: Mat, quad: Quad): SlabFound | null {
  const up = labelAbove(frame, quad)
  if (up) return { quad, labelV: up }
  // The same card turned half a turn: its bottom edge is the top.
  const turned: Quad = [quad[2], quad[3], quad[0], quad[1]]
  const down = labelAbove(frame, turned)
  return down ? { quad: turned, labelV: down } : null
}
