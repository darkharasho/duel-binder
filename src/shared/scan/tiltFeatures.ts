// How light moves across a straightened card while it's tilted: where the foil reflects, how much
// and in what colours, the grain of its pattern, and how the shine travels. A still frame can't
// tell foils apart this well (a Super from an Ultra, a Holo from a Cosmos Holo); the change
// between frames can. The frames are aligned onto the middle one and matched for the camera's
// auto-exposure first, so what changes is the foil and not the card's pose or the camera's gain.
//
// Pure TypeScript with no OpenCV and no Node APIs: scripts/scan/rarity/fit-tilt.ts fits the tilt
// model on these features and the scan worker reads them live, so the two can't drift apart. It
// is a faithful port of the tilt spike's feature code: same regions, math and order of
// operations, so its numbers match the spike's on the same frames.

import type { GameId } from '../games/types'
import type { RgbaImage } from './types'

/** Working width: a straightened card is box-shrunk to this before reading its tilt. */
export const TILT_W = 421
/** Working height, at the card's aspect. */
export const TILT_H = 614

/** The features a TiltModel reads, in vector order. */
export const TILT_FEATURES: readonly string[] = [
  'rxart',
  'rxname',
  'rxtext',
  'rxborder',
  'rxband',
  'rhart',
  'rhname',
  'rhtext',
  'rhborder',
  'rhband',
  'rxEntropy',
  'rxTop',
  'rxGold',
  'rxColour',
  'sp0',
  'sp1',
  'sp2',
  'sp3',
  'spAxis',
  'spSkew',
  'nameHueR',
  'gFlow',
  'artVsText',
  'artVsBorder',
  'textVsBorder'
]

/** One run of frames' tilt features. */
export interface TiltReading {
  /** TILT_FEATURES order. */
  features: number[]
  frames: number
  /** Mean |luminance change| on the art between aligned, exposure-matched frames, 0-255. */
  motion: number
}

type Box = readonly [x0: number, y0: number, x1: number, y1: number]
interface Regions {
  art: Box
  name: Box
  border: Box
  text: Box
  /** The strip left of the art, where a foil frame shows. */
  band: Box
}

const W2 = TILT_W
const H2 = TILT_H
// Half size, for the per-pixel amplitude statistics.
const W = 210
const H = 306

const REGIONS: Record<GameId, Regions> = {
  ygo: {
    art: [0.13, 0.19, 0.87, 0.71],
    name: [0.07, 0.045, 0.8, 0.105],
    border: [0.015, 0.2, 0.055, 0.9],
    text: [0.09, 0.76, 0.91, 0.92],
    band: [0.06, 0.13, 0.12, 0.72]
  },
  // On Pokémon cards `text` is the body under the art, where a reverse holo's foil sits.
  pkm: {
    art: [0.1, 0.14, 0.9, 0.47],
    name: [0.1, 0.05, 0.7, 0.1],
    border: [0.015, 0.2, 0.04, 0.9],
    text: [0.09, 0.53, 0.91, 0.88],
    band: [0.03, 0.14, 0.09, 0.47]
  }
}
// The reflection areas, in the order the spike reads them.
const AREAS = ['art', 'name', 'border', 'text', 'band'] as const

const lum = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b
const median = (a: readonly number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1] ?? 0
}
const pct = (s: ArrayLike<number>, p: number): number =>
  s[Math.min(s.length - 1, Math.floor(p * s.length))]
/** A box in whole pixels of the working size. */
const pixels = ([x0, y0, x1, y1]: Box): [number, number, number, number] => [
  Math.floor(x0 * W2),
  Math.floor(y0 * H2),
  Math.floor(x1 * W2),
  Math.floor(y1 * H2)
]

/** An upright straightened card (any size, RGBA), box-shrunk to TILT_W x TILT_H RGB. */
export function shrinkCard(card: RgbaImage): Uint8Array {
  const out = new Uint8Array(W2 * H2 * 3)
  const fx = card.width / W2
  const fy = card.height / H2
  const d = card.data
  for (let y = 0; y < H2; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < W2; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const k = (j * card.width + i) * 4
          r += d[k]
          g += d[k + 1]
          b += d[k + 2]
          n++
        }
      }
      const o = (y * W2 + x) * 3
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
    }
  }
  return out
}

function lumOf(f: ArrayLike<number>): Float32Array {
  const o = new Float32Array(W2 * H2)
  for (let i = 0; i < o.length; i++) o[i] = lum(f[i * 3], f[i * 3 + 1], f[i * 3 + 2])
  return o
}

function half(f: Float32Array): Float32Array {
  const o = new Float32Array(W * H * 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) {
        o[(y * W + x) * 3 + c] =
          (f[(y * 2 * W2 + x * 2) * 3 + c] +
            f[(y * 2 * W2 + x * 2 + 1) * 3 + c] +
            f[((y * 2 + 1) * W2 + x * 2) * 3 + c] +
            f[((y * 2 + 1) * W2 + x * 2 + 1) * 3 + c]) /
          4
      }
    }
  }
  return o
}

interface Shift {
  dx: number
  dy: number
  score: number
}

/** A reference patch, sampled every `step` px, with its zero-mean values kept for matching. */
interface Patch {
  px: number
  py: number
  size: number
  step: number
  n: number
  va: number
  /** The samples less their mean, row by row. */
  p: Float64Array
}

const PATCH = 41

/**
 * A patch of the reference, or null when it's too flat to say anything about a shift (it would
 * match anywhere). The reference is the same for every frame, so its patches are made once.
 */
function patchOf(
  a: Float32Array,
  px: number,
  py: number,
  size: number,
  step: number
): Patch | null {
  let ma = 0
  let n = 0
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      ma += a[(py + y) * W2 + px + x]
      n++
    }
  }
  ma /= n
  const p = new Float64Array(n)
  let va = 0
  let i = 0
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const d = a[(py + y) * W2 + px + x] - ma
      p[i++] = d
      va += d ** 2
    }
  }
  if (va / n < 30) return null
  return { px, py, size, step, n, va, p }
}

/** The coarse and fine reference patches alignment matches, on a 52 px grid. */
function patchesOf(refL: Float32Array): { coarse: Patch; fine: Patch }[] {
  const out: { coarse: Patch; fine: Patch }[] = []
  for (let py = 12; py + PATCH < H2 - 12; py += 52) {
    for (let px = 12; px + PATCH < W2 - 12; px += 52) {
      const coarse = patchOf(refL, px, py, PATCH, 4)
      const fine = patchOf(refL, px, py, PATCH, 1)
      if (coarse && fine) out.push({ coarse, fine })
    }
  }
  return out
}

/**
 * Each pixel's sum of the patch's sampled rows below it: the `PATCH / step` rows every `step` px.
 * It lets matchPatch total a shifted patch from one sum per sampled column instead of every sample.
 * Luminance from whole-number RGB is a float32 that is a multiple of 2^-27, and a patch sums to
 * under 2^19, so every partial sum fits a double exactly: any order of adding (or this sliding
 * window's subtracting) gives the very same total as the plain loop, bit for bit.
 */
function columnSums(L: Float64Array, step: number): Float64Array {
  const rows = Math.ceil(PATCH / step)
  const reach = (rows - 1) * step
  const out = new Float64Array(W2 * H2)
  for (let y = 0; y + reach < H2; y++) {
    const at = y * W2
    if (y < step) {
      for (let x = 0; x < W2; x++) {
        let s = 0
        for (let m = 0; m < rows; m++) s += L[at + m * step * W2 + x]
        out[at + x] = s
      }
    } else {
      const prev = at - step * W2
      const next = prev + rows * step * W2
      for (let x = 0; x < W2; x++) out[at + x] = out[prev + x] - L[prev + x] + L[next + x]
    }
  }
  return out
}

/**
 * Best integer shift of a reference patch onto `b` by zero-mean correlation, and its score.
 * `cols` is columnSums of `b` at the patch's step. The correlation sums run in the same order as
 * a plain loop over the patch, so the scores are bit for bit the same.
 */
function matchPatch(
  patch: Patch,
  b: Float64Array,
  cols: Float64Array,
  cx: number,
  cy: number,
  reach: number
): Shift | null {
  const { px, py, size, step, n, va, p } = patch
  let best: Shift | null = null
  for (let dy = cy - reach; dy <= cy + reach; dy++) {
    for (let dx = cx - reach; dx <= cx + reach; dx++) {
      if (px + dx < 0 || py + dy < 0 || px + dx + size >= W2 || py + dy + size >= H2) continue
      const origin = (py + dy) * W2 + px + dx
      let mb = 0
      for (let x = 0; x < size; x += step) mb += cols[origin + x]
      mb /= n
      let s = 0
      let vb = 0
      let i = 0
      for (let y = 0; y < size; y += step) {
        const row = origin + y * W2
        for (let x = 0; x < size; x += step) {
          const q = b[row + x] - mb
          s += p[i++] * q
          vb += q * q
        }
      }
      const score = s / Math.sqrt(va * vb + 1)
      if (!best || score > best.score) best = { dx, dy, score }
    }
  }
  return best
}

interface Match {
  x: number
  y: number
  u: number
  v: number
}
interface Affine {
  ax: number[]
  ay: number[]
}

/** Least-squares affine map from the reference onto the frame, dropping outlying patches. */
function fitAffine(points: Match[]): Affine | null {
  let pts = points
  let A: Affine | null = null
  for (let round = 0; round < 3 && pts.length >= 6; round++) {
    const solve = (key: 'u' | 'v'): number[] => {
      const M = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0]
      ]
      for (const p of pts) {
        const r = [p.x, p.y, 1]
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]
          M[i][3] += r[i] * p[key]
        }
      }
      for (let i = 0; i < 3; i++) {
        let m = i
        for (let j = i + 1; j < 3; j++) if (Math.abs(M[j][i]) > Math.abs(M[m][i])) m = j
        ;[M[i], M[m]] = [M[m], M[i]]
        for (let j = 0; j < 3; j++) {
          if (j === i) continue
          const f = M[j][i] / M[i][i]
          for (let k = i; k < 4; k++) M[j][k] -= f * M[i][k]
        }
      }
      return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]]
    }
    const ax = solve('u')
    const ay = solve('v')
    A = { ax, ay }
    const err = (p: Match): number =>
      Math.hypot(ax[0] * p.x + ax[1] * p.y + ax[2] - p.u, ay[0] * p.x + ay[1] * p.y + ay[2] - p.v)
    const es = pts.map(err).sort((a, b) => a - b)
    const cut = Math.max(1.5, es[es.length >> 1] * 2.5)
    pts = pts.filter((p) => err(p) <= cut)
  }
  return A
}

/** The frame resampled onto the reference's pixels; as it was when no fit can be trusted. */
function align(
  frame: Uint8Array,
  patches: readonly { coarse: Patch; fine: Patch }[]
): Float32Array {
  const L = Float64Array.from(lumOf(frame))
  const cols4 = columnSums(L, 4)
  const cols1 = columnSums(L, 1)
  const points: Match[] = []
  for (const { coarse: cp, fine: fp } of patches) {
    const coarse = matchPatch(cp, L, cols4, 0, 0, 16)
    if (!coarse || coarse.score < 0.5) continue
    const fine = matchPatch(fp, L, cols1, coarse.dx, coarse.dy, 3)
    if (fine && fine.score > 0.72) {
      points.push({
        x: fp.px + PATCH / 2,
        y: fp.py + PATCH / 2,
        u: fp.px + fine.dx + PATCH / 2,
        v: fp.py + fine.dy + PATCH / 2
      })
    }
  }
  const A = points.length >= 6 ? fitAffine(points) : null
  // Nearly collinear patches make a degenerate fit, which comes out NaN.
  if (!A || ![...A.ax, ...A.ay].every(Number.isFinite)) return Float32Array.from(frame)
  const out = new Float32Array(frame.length)
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      const u = A.ax[0] * x + A.ax[1] * y + A.ax[2]
      const v = A.ay[0] * x + A.ay[1] * y + A.ay[2]
      const x0 = Math.max(0, Math.min(W2 - 2, Math.floor(u)))
      const y0 = Math.max(0, Math.min(H2 - 2, Math.floor(v)))
      const fx = u - x0
      const fy = v - y0
      for (let c = 0; c < 3; c++) {
        const a = frame[(y0 * W2 + x0) * 3 + c]
        const b = frame[(y0 * W2 + x0 + 1) * 3 + c]
        const d = frame[((y0 + 1) * W2 + x0) * 3 + c]
        const e = frame[((y0 + 1) * W2 + x0 + 1) * 3 + c]
        out[(y * W2 + x) * 3 + c] =
          a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy
      }
    }
  }
  return out
}

/**
 * Cancels the camera's auto-exposure, in place, by the median brightness ratio to the reference
 * over a part of the card that isn't foil: a Yu-Gi-Oh! text box, or a Pokémon card's outer
 * border, since its body can be foil (reverse holos).
 */
function expose(f: Float32Array, ref: Float32Array, game: GameId): void {
  const cells: [number, number][] = []
  if (game === 'pkm') {
    for (let y = Math.floor(0.03 * H2); y < 0.97 * H2; y += 2) {
      for (const x0 of [0.012 * W2, 0.965 * W2]) {
        for (let x = Math.floor(x0); x < x0 + 0.022 * W2; x += 2) cells.push([x, y])
      }
    }
  } else {
    for (let y = Math.floor(0.77 * H2); y < 0.92 * H2; y += 3) {
      for (let x = Math.floor(0.1 * W2); x < 0.9 * W2; x += 3) cells.push([x, y])
    }
  }
  const ratios: number[] = []
  for (const [x, y] of cells) {
    const k = (y * W2 + x) * 3
    const a = lum(f[k], f[k + 1], f[k + 2])
    const b = lum(ref[k], ref[k + 1], ref[k + 2])
    // Near-black cells are mostly noise.
    if (a > 60 && b > 60) ratios.push(b / a)
  }
  if (ratios.length < 50) return
  const g = median(ratios)
  for (let i = 0; i < f.length; i++) f[i] = Math.min(255, f[i] * g)
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1
    for (; j & b; b >>= 1) j ^= b
    j ^= b
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((2 * Math.PI) / len) * -1
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len >> 1; k++) {
        const c = Math.cos(a * k)
        const s = Math.sin(a * k)
        const u = i + k
        const v = u + (len >> 1)
        const x = re[v] * c - im[v] * s
        const y = re[v] * s + im[v] * c
        re[v] = re[u] - x
        im[v] = im[u] - y
        re[u] += x
        im[u] += y
      }
    }
  }
}

/**
 * What the foil adds over the print: each pixel's light above its own dimmest frames (its 15th
 * percentile), read for how much there is per area, its colour on the art, and the spectrum of
 * its pattern. The residual is computed only where it's read, which gives the same numbers as
 * computing it everywhere at a fraction of the cost.
 */
function reflection(big: readonly Float32Array[], regions: Regions): Record<string, number> {
  const T = big.length
  const N = W2 * H2
  const base = new Float32Array(N * 3)
  const known = new Uint8Array(N)
  const tmp = new Float32Array(T)
  const ensure = (p: number): void => {
    if (known[p]) return
    known[p] = 1
    for (let c = 0; c < 3; c++) {
      const i = p * 3 + c
      for (let t = 0; t < T; t++) tmp[t] = big[t][i]
      // A typed array sorts numerically.
      tmp.sort()
      base[i] = tmp[Math.floor(T * 0.15)]
    }
  }
  // Rounded to float32, as the spike stores its residual frames.
  const res = (t: number, i: number): number => Math.fround(Math.max(0, big[t][i] - base[i]))
  const out: Record<string, number> = {}
  for (const name of AREAS) {
    const [x0, y0, x1, y1] = regions[name]
    let sum = 0
    let n = 0
    let hot = 0
    for (let y = Math.floor(y0 * H2); y < y1 * H2; y += 2) {
      for (let x = Math.floor(x0 * W2); x < x1 * W2; x += 2) {
        const p = y * W2 + x
        ensure(p)
        const k = p * 3
        let peak = 0
        let e = 0
        for (let t = 0; t < T; t++) {
          const v = lum(res(t, k), res(t, k + 1), res(t, k + 2))
          e += v
          if (v > peak) peak = v
        }
        sum += e / T
        n++
        if (peak > 40) hot++
      }
    }
    out['rx' + name] = sum / n
    out['rh' + name] = hot / n
  }

  const [ax0, ay0, ax1, ay1] = pixels(regions.art)
  for (let y = ay0; y < ay1; y += 2) for (let x = ax0; x < ax1; x += 2) ensure(y * W2 + x)
  // Float32, as in the spike, so the sums round alike.
  const bins = new Float32Array(12)
  let white = 0
  let colour = 0
  for (let t = 0; t < T; t++) {
    for (let y = ay0; y < ay1; y += 2) {
      for (let x = ax0; x < ax1; x += 2) {
        const k = (y * W2 + x) * 3
        const R = res(t, k)
        const G = res(t, k + 1)
        const B = res(t, k + 2)
        const m = Math.max(R, G, B)
        const d = m - Math.min(R, G, B)
        if (m < 25) continue
        white += m - d
        colour += d
        if (d < 8) continue
        const h = m === R ? ((G - B) / d + 6) % 6 : m === G ? (B - R) / d + 2 : (R - G) / d + 4
        bins[Math.floor(h * 2) % 12] += d
      }
    }
  }
  const total = bins.reduce((a, b) => a + b, 0) || 1
  out.rxEntropy =
    -[...bins].reduce((s, b) => s + (b > 0 ? (b / total) * Math.log(b / total) : 0), 0) /
    Math.log(12)
  out.rxTop = Math.max(...bins) / total
  out.rxGold = (bins[1] + bins[2]) / total
  out.rxColour = colour / (colour + white + 1)

  // The pattern: spectrum of the reflection in the art's centre, over its brightest frames.
  const S = 128
  const cx = (ax0 + ax1 - S) >> 1
  const cy = (ay0 + ay1 - S) >> 1
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) ensure((cy + y) * W2 + cx + x)
  const energy = big
    .map((_, t) => {
      let e = 0
      for (let y = 0; y < S; y += 4) {
        for (let x = 0; x < S; x += 4) e += res(t, ((cy + y) * W2 + cx + x) * 3 + 1)
      }
      return { t, e }
    })
    .sort((a, b) => b.e - a.e)
    .slice(0, 8)
  const bands = [0, 0, 0, 0]
  const ang = [0, 0, 0, 0]
  const edges = [3, 8, 18, 36, 64]
  const re = new Float64Array(S * S)
  const im = new Float64Array(S * S)
  const colRe = new Float64Array(S)
  const colIm = new Float64Array(S)
  for (const { t } of energy) {
    im.fill(0)
    let m = 0
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = ((cy + y) * W2 + cx + x) * 3
        const v = lum(res(t, k), res(t, k + 1), res(t, k + 2))
        re[y * S + x] = v
        m += v
      }
    }
    m /= S * S
    // A sine window, so the patch's edges don't add spectrum of their own.
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        re[y * S + x] =
          (re[y * S + x] - m) *
          Math.sin((Math.PI * (x + 0.5)) / S) *
          Math.sin((Math.PI * (y + 0.5)) / S)
      }
    }
    for (let y = 0; y < S; y++)
      fft(re.subarray(y * S, (y + 1) * S), im.subarray(y * S, (y + 1) * S))
    for (let x = 0; x < S; x++) {
      for (let y = 0; y < S; y++) {
        colRe[y] = re[y * S + x]
        colIm[y] = im[y * S + x]
      }
      fft(colRe, colIm)
      for (let y = 0; y < S; y++) {
        re[y * S + x] = colRe[y]
        im[y * S + x] = colIm[y]
      }
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x < S / 2 ? x : x - S
        const v = y < S / 2 ? y : y - S
        const f = Math.hypot(u, v)
        const p = re[y * S + x] ** 2 + im[y * S + x] ** 2
        for (let b = 0; b < 4; b++) if (f >= edges[b] && f < edges[b + 1]) bands[b] += p
        if (f >= 8 && f < 40)
          ang[Math.floor(((Math.atan2(v, u) + Math.PI) / Math.PI) * 4 + 0.5) % 4] += p
      }
    }
  }
  const bt = bands.reduce((a, b) => a + b, 0) || 1
  const at = ang.reduce((a, b) => a + b, 0) || 1
  bands.forEach((b, i) => {
    out['sp' + i] = b / bt
  })
  out.spAxis = (ang[0] + ang[2]) / at
  out.spSkew = Math.abs(ang[1] - ang[3]) / at
  return out
}

/**
 * Each pixel's luminance swing over the run (10th to 90th percentile), at half size: the mean
 * per region, and how tightly the hue at a swinging pixel's brightest frame clusters (HueR).
 */
function amplitude(
  small: readonly Float32Array[],
  box: Box,
  withHue: boolean
): { mean: number; hueR: number } {
  const [x0, y0, x1, y1] = box
  const T = small.length
  const L: number[] = new Array(T)
  const sorted = new Float64Array(T)
  const amps: number[] = []
  let cosSum = 0
  let sinSum = 0
  let peaks = 0
  for (let y = Math.floor(y0 * H); y < y1 * H; y++) {
    for (let x = Math.floor(x0 * W); x < x1 * W; x++) {
      const o = (y * W + x) * 3
      for (let t = 0; t < T; t++) L[t] = lum(small[t][o], small[t][o + 1], small[t][o + 2])
      // A typed array sorts numerically, as the comparator would.
      sorted.set(L)
      sorted.sort()
      const amp = pct(sorted, 0.9) - pct(sorted, 0.1)
      amps.push(amp)
      if (!withHue || !(amp > 25)) continue
      const opp = small.map((f): [number, number] => [
        (f[o] - f[o + 1]) * 0.866,
        f[o + 2] - (f[o] + f[o + 1]) / 2
      ])
      const pk = L.indexOf(Math.max(...L))
      const a = opp[pk][0] - median(opp.map((v) => v[0]))
      const b = opp[pk][1] - median(opp.map((v) => v[1]))
      const hue = Math.atan2(b, a)
      cosSum += Math.cos(hue)
      sinSum += Math.sin(hue)
      peaks++
    }
  }
  // Too few swinging pixels make no hue to speak of; the spike leaves it out, which reads as 0.
  const hueR = peaks > 20 ? Math.hypot(cosSum / peaks, sinSum / peaks) : 0
  // Summed in ascending order, as the spike does, so the rounding matches.
  amps.sort((a, b) => a - b)
  return { mean: amps.reduce((a, b) => a + b, 0) / amps.length, hueR }
}

/**
 * Whether the shine flows: the correlation of consecutive changes in the art (frame t to t+1
 * against t+1 to t+gap), averaged over the pairs that change enough to measure.
 */
function flow(big: readonly Float32Array[], art: Box): number {
  const T = big.length
  const [x0, y0, x1, y1] = pixels(art)
  const w = x1 - x0
  const h = y1 - y0
  const L = big.map((f) => {
    const o = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = ((y + y0) * W2 + x + x0) * 3
        o[y * w + x] = lum(f[k], f[k + 1], f[k + 2])
      }
    }
    return o
  })
  let adj = 0
  let adjN = 0
  const gap = Math.min(3, T - 1)
  const dlt = new Float32Array(w * h)
  for (let t = 0; t + gap < T; t += 2) {
    const a = L[t]
    const b = L[t + gap]
    let m = 0
    for (let i = 0; i < w * h; i++) {
      dlt[i] = b[i] - a[i]
      m += dlt[i]
    }
    m /= w * h
    let v = 0
    for (let i = 0; i < w * h; i++) {
      dlt[i] -= m
      v += dlt[i] * dlt[i]
    }
    if (v / (w * h) < 4) continue
    if (gap >= 2) {
      let s = 0
      let va = 0
      let vb = 0
      const c = L[t + 1]
      for (let i = 0; i < w * h; i += 3) {
        const p = c[i] - a[i]
        const q = b[i] - c[i]
        s += p * q
        va += p * p
        vb += q * q
      }
      adj += s / Math.sqrt(va * vb + 1)
      adjN++
    }
  }
  return adj / Math.max(1, adjN)
}

/** The largest mean |luminance change| on the art between any two frames, sampled every 2 px. */
function motionOf(big: readonly Float32Array[], art: Box): number {
  const [ax0, ay0, ax1, ay1] = pixels(art)
  const samples = big.map((f) => {
    const v: number[] = []
    for (let y = 8; y < H2 - 8; y += 2) {
      if (y < ay0 || y >= ay1) continue
      for (let x = 8; x < W2 - 8; x += 2) {
        if (x < ax0 || x >= ax1) continue
        const k = (y * W2 + x) * 3
        v.push(lum(f[k], f[k + 1], f[k + 2]))
      }
    }
    return Float64Array.from(v)
  })
  let most = 0
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i]
      const b = samples[j]
      let s = 0
      for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k])
      most = Math.max(most, s / a.length)
    }
  }
  return most
}

/** The tilt features over frames from shrinkCard, in time order; null for fewer than 3. */
export function tiltFeatures(frames: readonly Uint8Array[], game: GameId): TiltReading | null {
  // A frame of another size would be read at the wrong pixels without any error of its own.
  const bad = frames.findIndex((f) => f.length !== W2 * H2 * 3)
  if (bad >= 0) {
    throw new Error(`Tilt frame ${bad} has ${frames[bad].length} values, not ${W2}x${H2} RGB`)
  }
  // Fewer than three frames have no consecutive changes to compare.
  if (frames.length < 3) return null
  const regions = REGIONS[game]
  const refAt = frames.length >> 1
  const patches = patchesOf(lumOf(frames[refAt]))
  const big = frames.map((f, i) => (i === refAt ? Float32Array.from(f) : align(f, patches)))
  const ref = big[refAt]
  for (const f of big) expose(f, ref, game)
  const motion = motionOf(big, regions.art)
  const small = big.map(half)
  const art = amplitude(small, regions.art, false)
  const text = amplitude(small, regions.text, false)
  const name = amplitude(small, regions.name, true)
  const v: Record<string, number> = reflection(big, regions)
  v.nameHueR = name.hueR
  v.gFlow = flow(big, regions.art)
  v.artVsText = art.mean / Math.max(1, text.mean)
  v.artVsBorder = v.rxart / Math.max(1e-6, v.rxborder)
  v.textVsBorder = v.rxtext / Math.max(1e-6, v.rxborder)
  return { features: TILT_FEATURES.map((f) => v[f]), frames: frames.length, motion }
}
