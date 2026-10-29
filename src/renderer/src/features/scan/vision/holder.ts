// Whether a card is in a graded slab (PSA, BGS, CGC...): a slab carries a white label block with
// printed text above the card, inside a wider clear holder. A toploader or a magnetic case has no
// label, so it reads as a bare card. Only the strips round the label are sampled, never the whole
// frame, so it's cheap enough for every frame.
import {
  SLAB_INK_DARKER_BY,
  SLAB_LABEL_MIN_BRIGHT,
  SLAB_LABEL_MIN_PAPER_SHARE,
  SLAB_LABEL_U,
  SLAB_LABEL_V,
  SLAB_MIN_CONTRAST,
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

/** Whether a label block shows above the card whose corners (clockwise from top-left) are p. */
function labelAbove(frame: Mat, p: Quad): boolean {
  const label = sample(frame, p, [...SLAB_LABEL_U, ...SLAB_LABEL_V], COLS, ROWS)
  if (label.missed > 0.2 * COLS * ROWS) return false
  const paper = label.luma.filter((l) => l >= SLAB_LABEL_MIN_BRIGHT)
  if (paper.length < SLAB_LABEL_MIN_PAPER_SHARE * label.luma.length) return false
  const paperLuma = mean(paper)
  if (flips(label.luma, COLS, paperLuma - SLAB_INK_DARKER_BY) < SLAB_TEXT_MIN_FLIPS) return false
  // The holder beside the label and the strip above it are plastic over the desk, not paper.
  const [v0, v1] = SLAB_LABEL_V
  const [u0, u1] = SLAB_LABEL_U
  const around = [
    sample(frame, p, [u0 - 0.2, u0 - 0.08, v0, v1], 3, ROWS),
    sample(frame, p, [u1 + 0.08, u1 + 0.2, v0, v1], 3, ROWS),
    sample(frame, p, [u0, u1, v0 - 0.12, v0 - 0.04], COLS, 3)
  ]
  return around.every((s) => s.luma.length > 0 && paperLuma - mean(s.luma) >= SLAB_MIN_CONTRAST)
}

/**
 * Whether the card at quad (in frame's pixels) sits in a graded slab: a bright label block with
 * text above it (or below it, for a card read upside down), set in clear plastic. Sized by the
 * card's own width and height, so it holds at any distance. When unsure, false: a wrong "slab"
 * only adds a Raw tag, but neither answer changes which card is named.
 */
export function isSlab(_cv: CV, frame: Mat, quad: Quad): boolean {
  if (labelAbove(frame, quad)) return true
  // The same card turned half a turn: its bottom edge is the top.
  return labelAbove(frame, [quad[2], quad[3], quad[0], quad[1]])
}
