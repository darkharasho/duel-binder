// Which version of a Gem Pack card a photo shows, from its pattern. A Gem Pack prints each card in
// several versions, numbered apart (CBB7C 1501 to 1507), whose art is the same; they differ in the
// foil across the text box: a big energy symbol, a Poké Ball, a Master Ball, glitter, or the set's
// logo stamped on the art. The symbols and the stamp are one drawing on every card, tinted to the
// card's type, so each is told by matching a template (gemPatterns.json, averaged from the owner's
// photos by scripts/scan/gem-patterns.ts) at its place on the upright card. The glitter versions
// aren't told apart: their foil reads alike at a webcam's size.
import templates from './gemPatterns.json'
import {
  GEM_BALL_MIN,
  GEM_ENERGY_MIN,
  GEM_MASTER_MIN,
  GEM_MARGIN_NEAR,
  GEM_MARGIN_WIDE,
  GEM_STAMP_MIN
} from './thresholds'
import type { RgbaImage } from './types'

/** How well each template matches an upright card: normalised cross-correlation, -1 to 1. */
export interface GemScores {
  energy: number
  ball: number
  master: number
  stamp: number
}

export type GemPattern = keyof GemScores

/** The card, shrunk to W x H by area averaging: luma and the three colour channels. */
export const W = 84
export const H = 123

/** Where on the shrunk card the symbol (lower right of the text box) and the stamp (art, lower left) sit. */
export const SYMBOL = { x0: 30, y0: 66, w: 50, h: 46 }
export const STAMP = { x0: 2, y0: 40, w: 22, h: 17 }
/** How far a window is slid to find its best match: a straightened photo is off by a few pixels. */
const SYMBOL_SHIFT = { x: [-4, 4], y: [-4, 4] }
const STAMP_SHIFT = { x: [-2, 4], y: [-4, 4] }

type Box = typeof SYMBOL

export interface Shrunk {
  /** Luma, red, green, blue: W x H each. */
  channels: [Float32Array, Float32Array, Float32Array, Float32Array]
}

/** Area averages over whole source pixels, like the prototype the templates were tuned on. */
export function shrink(img: RgbaImage): Shrunk {
  const { width, height, data } = img
  const l = new Float32Array(W * H)
  const r = new Float32Array(W * H)
  const g = new Float32Array(W * H)
  const b = new Float32Array(W * H)
  const sx = width / W
  const sy = height / H
  for (let y = 0; y < H; y++) {
    const ys = Math.floor(y * sy)
    const ye = Math.max(ys + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < W; x++) {
      const xs = Math.floor(x * sx)
      const xe = Math.max(xs + 1, Math.floor((x + 1) * sx))
      let rs = 0
      let gs = 0
      let bs = 0
      let n = 0
      for (let yy = ys; yy < ye; yy++) {
        let i = (yy * width + xs) * 4
        for (let xx = xs; xx < xe; xx++, i += 4) {
          rs += data[i]
          gs += data[i + 1]
          bs += data[i + 2]
          n++
        }
      }
      const k = y * W + x
      r[k] = rs / n
      g[k] = gs / n
      b[k] = bs / n
      l[k] = 0.299 * r[k] + 0.587 * g[k] + 0.114 * b[k]
    }
  }
  return { channels: [l, r, g, b] }
}

/** A 3x3 box blur; the border stays 0. */
function blur(a: Float32Array): Float32Array {
  const out = new Float32Array(a.length)
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) s += a[(y + dy) * W + x + dx]
      out[y * W + x] = s / 9
    }
  return out
}

/** A box of a channel at an offset, as zero mean and unit deviation; outside the card reads 0. */
export function window(a: Float32Array, box: Box, dx = 0, dy = 0): Float32Array {
  const out = new Float32Array(box.w * box.h)
  let sum = 0
  let sq = 0
  for (let y = 0; y < box.h; y++)
    for (let x = 0; x < box.w; x++) {
      const yy = box.y0 + dy + y
      const xx = box.x0 + dx + x
      const v = yy >= 0 && yy < H && xx >= 0 && xx < W ? a[yy * W + xx] : 0
      out[y * box.w + x] = v
      sum += v
      sq += v * v
    }
  const mean = sum / out.length
  const sd = Math.sqrt(Math.max(1e-6, sq / out.length - mean * mean))
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd
  return out
}

/** The best correlation of a template over the box slid within shift. */
function match(
  a: Float32Array,
  box: Box,
  shift: typeof SYMBOL_SHIFT,
  template: ArrayLike<number>
): number {
  let best = -1
  for (let dy = shift.y[0]; dy <= shift.y[1]; dy++)
    for (let dx = shift.x[0]; dx <= shift.x[1]; dx++) {
      const w = window(a, box, dx, dy)
      let s = 0
      for (let i = 0; i < w.length; i++) s += w[i] * template[i]
      best = Math.max(best, s / w.length)
    }
  return best
}

/**
 * The channel the symbol shows best in: blurred (glitter is finer than the symbol), whichever of
 * luma, red, green and blue varies most across the symbol's box. A dark card's blue symbol on teal
 * hardly shows in luma.
 */
export function symbolChannel(s: Shrunk): Float32Array {
  let pick = s.channels[0]
  let top = -1
  for (const raw of s.channels) {
    const c = blur(raw)
    let sum = 0
    let sq = 0
    let n = 0
    for (let y = SYMBOL.y0; y < SYMBOL.y0 + SYMBOL.h; y++)
      for (let x = SYMBOL.x0; x < SYMBOL.x0 + SYMBOL.w; x++) {
        const v = c[y * W + x]
        sum += v
        sq += v * v
        n++
      }
    const sd = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2))
    if (sd > top) {
      top = sd
      pick = c
    }
  }
  return pick
}

/** The windows a template is averaged from: the symbol's, and the stamp's in luma. */
export function gemWindows(img: RgbaImage): { symbol: Float32Array; stamp: Float32Array } {
  const s = shrink(img)
  return { symbol: window(symbolChannel(s), SYMBOL), stamp: window(s.channels[0], STAMP) }
}

export interface GemTemplates {
  energy: ArrayLike<number>
  ball: ArrayLike<number>
  master: ArrayLike<number>
  stamp: ArrayLike<number>
}

/** The template scores of an upright card (842x1228, or any size of that shape). */
export function gemScores(
  img: RgbaImage,
  t: GemTemplates = templates as unknown as GemTemplates
): GemScores {
  const s = shrink(img)
  const sym = symbolChannel(s)
  const round = (n: number): number => Math.round(n * 1000) / 1000
  return {
    energy: round(match(sym, SYMBOL, SYMBOL_SHIFT, t.energy)),
    ball: round(match(sym, SYMBOL, SYMBOL_SHIFT, t.ball)),
    master: round(match(sym, SYMBOL, SYMBOL_SHIFT, t.master)),
    stamp: round(match(s.channels[0], STAMP, STAMP_SHIFT, t.stamp))
  }
}

/**
 * The pattern the scores name, or null when none is decisive. A symbol must match well and beat
 * the other two by a margin: an energy symbol sits in a disc of the ball's size, so the ball and
 * energy templates both match either, the right one only a little better; the Master Ball's "M"
 * sets it further apart. The stamp is named only with no symbol named.
 */
export function gemPattern(s: GemScores | null | undefined): GemPattern | null {
  if (!s) return null
  if (
    s.ball >= GEM_BALL_MIN &&
    s.ball - s.energy >= GEM_MARGIN_WIDE &&
    s.ball - s.master >= GEM_MARGIN_WIDE
  )
    return 'ball'
  if (
    s.master >= GEM_MASTER_MIN &&
    s.master - s.ball >= GEM_MARGIN_NEAR &&
    s.master - s.energy >= GEM_MARGIN_WIDE
  )
    return 'master'
  if (
    s.energy >= GEM_ENERGY_MIN &&
    s.energy - s.ball >= GEM_MARGIN_NEAR &&
    s.energy - s.master >= GEM_MARGIN_WIDE
  )
    return 'energy'
  if (s.stamp >= GEM_STAMP_MIN) return 'stamp'
  return null
}

/** The catalog's rarity for a pattern, where the catalog names it. */
const PATTERN_RARITY: Partial<Record<GemPattern, string>> = {
  ball: 'Poke Ball Pattern',
  master: 'Master Ball Pattern',
  stamp: 'Set Logo Holofoil'
}

/**
 * Gem Packs whose energy-symbol version is a number's last two digits; the catalog calls it only
 * Holofoil, like the glitter versions. Only Vol. 7's has been seen.
 */
const ENERGY_VERSION: Record<string, string> = { CBB7C: '01' }

/**
 * The option of the pattern the scores name, when exactly one option is that pattern's version;
 * null otherwise.
 */
export function gemVersion<T extends { setCode: string; rarity: string | null }>(
  scores: GemScores | null | undefined,
  options: T[]
): T | null {
  const pattern = gemPattern(scores)
  if (!pattern) return null
  const rarity = PATTERN_RARITY[pattern]
  const hits = options.filter((o) => {
    if (rarity) return o.rarity === rarity
    const [set, number] = o.setCode.split(' ')
    const version = ENERGY_VERSION[set]
    return !!version && !!number && number.length === 4 && number.endsWith(version)
  })
  return hits.length === 1 ? hits[0] : null
}
