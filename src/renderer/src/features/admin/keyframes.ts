/**
 * Picks key frames out of a live pack opening: the sharpest frame of each still stretch (a card
 * held up to the camera), saying whether the whole frame looks unlike the last key frame (not the
 * same card held for a while, or an empty table). It works on small grey copies of the samples,
 * all the same size; the caller grabs the full frame for a pick, decides whether to keep it (on
 * the card itself when it can find one, see cardLook) and marks what it keeps.
 */

/** The small grey copy's size: big enough to see a card move, small enough for every sample. */
export const PICK_W = 320
export const PICK_H = 180

export interface PickerOptions {
  /** Mean absolute grey change between samples below which nothing is moving. */
  still: number
  /** How far a still stretch must differ from the last key frame to be a new one. */
  fresh: number
  /** Samples a stretch must stay still before its best one is picked. */
  stillSamples: number
}

export const DEFAULT_PICKER: PickerOptions = { still: 2.5, fresh: 6, stillSamples: 3 }

export type PickerState = 'moving' | 'settling' | 'held'

export interface Pick {
  /** The picked sample's sequence number, as `push` returned it. */
  seq: number
  sharp: number
  /** The whole frame differs from the last key frame by more than `fresh`. */
  fresh: boolean
}

/** Mean absolute difference of two grey images, on every other pixel. */
export function motion(a: Uint8Array, b: Uint8Array): number {
  let d = 0
  let n = 0
  for (let i = 0; i < a.length; i += 2) {
    d += Math.abs(a[i] - b[i])
    n++
  }
  return n ? d / n : 0
}

/** Variance of a 4-neighbour Laplacian: higher is sharper. */
export function sharpness(g: Uint8Array, w: number, h: number): number {
  let s = 0
  let s2 = 0
  let n = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]
      s += l
      s2 += l * l
      n++
    }
  return n ? s2 / n - (s / n) ** 2 : 0
}

/** RGBA pixels (a canvas's ImageData) to grey, BT.601 weights. */
export function toGrey(rgba: Uint8ClampedArray): Uint8Array {
  const g = new Uint8Array(rgba.length / 4)
  for (let i = 0, j = 0; j < g.length; i += 4, j++)
    g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  return g
}

export class KeyframePicker {
  private prev: Uint8Array | null = null
  private run: { seq: number; grey: Uint8Array; sharp: number }[] = []
  private picked = false
  private last: Uint8Array | null = null
  private seq = 0
  state: PickerState = 'moving'

  constructor(
    private readonly w = PICK_W,
    private readonly h = PICK_H,
    private readonly opts: PickerOptions = DEFAULT_PICKER
  ) {}

  /**
   * Adds the next sample; returns its sequence number, and the pick when this sample completes
   * a still stretch. The pick may be an earlier sample of the stretch (the sharpest), so the
   * caller keeps the last few full frames by sequence number.
   */
  push(grey: Uint8Array): { seq: number; pick: Pick | null } {
    const seq = ++this.seq
    const m = this.prev ? motion(grey, this.prev) : Infinity
    this.prev = grey
    if (m >= this.opts.still) {
      this.run = []
      this.picked = false
      this.state = 'moving'
      return { seq, pick: null }
    }
    this.run.push({ seq, grey, sharp: sharpness(grey, this.w, this.h) })
    if (this.picked) return { seq, pick: null }
    if (this.run.length < this.opts.stillSamples) {
      this.state = 'settling'
      return { seq, pick: null }
    }
    this.picked = true
    this.state = 'held'
    const best = this.run.reduce((a, b) => (b.sharp > a.sharp ? b : a))
    const fresh = !this.last || motion(best.grey, this.last) > this.opts.fresh
    return { seq, pick: { seq: best.seq, sharp: best.sharp, fresh } }
  }

  /**
   * The frame just kept (picked or kept by hand) becomes the last key frame; one kept by hand
   * also ends the stretch, so holding still doesn't keep it twice.
   */
  markKept(grey: Uint8Array): void {
    this.last = grey
    this.picked = true
  }

  reset(): void {
    this.prev = null
    this.run = []
    this.picked = false
    this.last = null
    this.state = 'moving'
  }
}
