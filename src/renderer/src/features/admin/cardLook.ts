/**
 * Whether two key frames show the same card, judged on the card alone. At rip distance the card
 * is a small part of the frame, so a small hand move or foil shimmer changes the whole frame more
 * than swapping one card for another does; comparing the card itself, found and flattened the way
 * the scanner finds it, tells the two apart.
 */
import type { RgbaImage } from '@shared/scan/types'
import { centreCrop } from '../scan/crop'
import type { CV } from '../scan/vision/cv'
import { findCandidates } from '../scan/vision/candidates'
import { warpCard, type Quad } from '../scan/vision/detect'
import { crop } from '@shared/scan/regions'

/** The frame width the card is looked for at: the scanner's search runs at 640 anyway. */
export const LOOK_W = 1280
/** The flattened card's width, and the block size it is averaged over. */
const CARD_W = 48
const BLOCK = 4
/**
 * Below this (100 × (1 − correlation) of the cards' block averages) two frames hold the same
 * card. On the 2026-11 One Piece rips: the same card 1.6–18 (one foil card under changing light 56),
 * different cards 24 and up, most over 40.
 */
export const SAME_CARD = 20
/**
 * An outline covering more of the frame than this is the hand or the table, not a card held up
 * (a held card fills about a tenth of the scanner's crop).
 */
const MAX_CARD_SHARE = 0.5

function area(q: Quad): number {
  let a = 0
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i]
    const [x2, y2] = q[(i + 1) % 4]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/**
 * The card's look: its flattened grey copy averaged over BLOCK × BLOCK blocks, scaled to zero mean
 * and unit spread so light and foil glare count for less. Null when no card is found.
 */
export function cardLook(cv: CV, frame: RgbaImage): Float32Array | null {
  const r = centreCrop(frame.width, frame.height)
  const img = crop(frame, [
    r.x / frame.width,
    r.y / frame.height,
    (r.x + r.width) / frame.width,
    (r.y + r.height) / frame.height
  ])
  const quad = findCandidates(cv, img).find(
    (q) => area(q) <= MAX_CARD_SHARE * img.width * img.height
  )
  if (!quad) return null
  const card = warpCard(cv, img, quad, CARD_W)
  return blockLook(card)
}

/** RGBA card to the block-averaged, normalised look. */
export function blockLook(card: RgbaImage): Float32Array {
  const { width: w, height: h, data } = card
  const bw = Math.floor(w / BLOCK)
  const bh = Math.floor(h / BLOCK)
  const out = new Float32Array(bw * bh)
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let s = 0
      for (let y = by * BLOCK; y < (by + 1) * BLOCK; y++)
        for (let x = bx * BLOCK; x < (bx + 1) * BLOCK; x++) {
          const i = (y * w + x) * 4
          s += data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29
        }
      out[by * bw + bx] = s
    }
  let mean = 0
  for (const v of out) mean += v
  mean /= out.length
  let sd = 0
  for (const v of out) sd += (v - mean) ** 2
  sd = Math.sqrt(sd / out.length) || 1
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd
  return out
}

/** 100 × (1 − correlation) of two looks: 0 the same, 100 unrelated. */
export function lookDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) return 100
  let c = 0
  for (let i = 0; i < a.length; i++) c += a[i] * b[i]
  return 100 * (1 - c / a.length)
}
