// Exploratory texture features over regions of upright cards, for choosing rarity cues.
import type { RgbaImage } from '@shared/scan/types'

export type Box = readonly [number, number, number, number]

/** Luma of img shrunk by f (box average), as Float32. */
export function lumaAt(
  img: RgbaImage,
  f: number
): { w: number; h: number; l: Float32Array; s: Float32Array; hx: Float32Array; hy: Float32Array } {
  const w = Math.floor(img.width / f)
  const h = Math.floor(img.height / f)
  const l = new Float32Array(w * h)
  const s = new Float32Array(w * h)
  const hx = new Float32Array(w * h)
  const hy = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * img.width + x * f + dx) * 4
          r += img.data[i]
          g += img.data[i + 1]
          b += img.data[i + 2]
        }
      const n = f * f
      r /= n
      g /= n
      b /= n
      const p = y * w + x
      l[p] = 0.299 * r + 0.587 * g + 0.114 * b
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      s[p] = max ? (max - min) / max : 0
      // Opponent-colour hue vector.
      hx[p] = r - (g + b) / 2
      hy[p] = 0.866 * (g - b)
    }
  return { w, h, l, s, hx, hy }
}

export interface RegionStats {
  /** Mean |L - 3x3 mean|. */
  hf: number
  /** Mean |L - 7x7 mean| (mid frequency). */
  mf: number
  /** Share of pixels that are bright points: over their 5x5 mean by 18 and over the region's p70. */
  sparkle: number
  /** ...by 30. */
  sparkle2: number
  /** Mean saturation. */
  sat: number
  /** Spread of the hue vector of HF chroma residual (colour noise). */
  chromaHf: number
  /** Share of gradient energy (of HF luma) along the diagonals. */
  diag: number
  /** Share along horizontal/vertical. */
  axis: number
  /** Mean luma. */
  mean: number
  /** Luma std. */
  std: number
  /** Ratio of hf to mf: fine vs coarse texture. */
  fineRatio: number
  /** 98th percentile of |L - 3x3 mean|: how crisp the region's sharpest edges are. */
  edge98: number
  /** Median |L - 3x3 mean|: the texture floor. */
  hfMed: number
}

function boxMean(a: Float32Array, w: number, h: number, r: number): Float32Array {
  // Separable box filter with clamped edges.
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1)
      acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1)
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

export interface Planes {
  w: number
  h: number
  l: Float32Array
  s: Float32Array
  hx: Float32Array
  hy: Float32Array
  b1: Float32Array
  b2: Float32Array
  b3: Float32Array
  cx1: Float32Array
  cy1: Float32Array
}

export function planes(img: RgbaImage, f: number): Planes {
  const p = lumaAt(img, f)
  return {
    ...p,
    b1: boxMean(p.l, p.w, p.h, 1),
    b2: boxMean(p.l, p.w, p.h, 2),
    b3: boxMean(p.l, p.w, p.h, 3),
    cx1: boxMean(p.hx, p.w, p.h, 1),
    cy1: boxMean(p.hy, p.w, p.h, 1)
  }
}

export function regionStats(P: Planes, box: Box): RegionStats {
  const { w, h, l, s, b1, b2, b3 } = P
  const x0 = Math.max(2, Math.round(box[0] * w))
  const x1 = Math.min(w - 3, Math.round(box[2] * w))
  const y0 = Math.max(2, Math.round(box[1] * h))
  const y1 = Math.min(h - 3, Math.round(box[3] * h))
  const vals: number[] = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(l[y * w + x])
  vals.sort((a, b) => a - b)
  const p70 = vals[Math.floor(vals.length * 0.7)] ?? 0
  let n = 0
  let hf = 0
  let mf = 0
  let sp = 0
  let sp2 = 0
  let sat = 0
  let chroma = 0
  let diag = 0
  let axis = 0
  let mean = 0
  let sq = 0
  const hfs: number[] = []
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * w + x
      const v = l[i]
      n++
      hfs.push(Math.abs(v - b1[i]))
      mean += v
      sq += v * v
      hf += Math.abs(v - b1[i])
      mf += Math.abs(v - b3[i])
      if (v > b2[i] + 18 && v > p70) sp++
      if (v > b2[i] + 30 && v > p70) sp2++
      sat += s[i]
      chroma += Math.hypot(P.hx[i] - P.cx1[i], P.hy[i] - P.cy1[i])
      // Gradient of the HF residual.
      const r = (j: number): number => l[j] - b1[j]
      const gx = r(i + 1) - r(i - 1)
      const gy = r(i + w) - r(i - w)
      const e = gx * gx + gy * gy
      // Orientation folded into [0, pi).
      const a = Math.atan2(gy, gx)
      const c2 = Math.cos(4 * a) // +1 on axes, -1 on diagonals
      if (c2 < -0.5) diag += e
      else if (c2 > 0.5) axis += e
    }
  const tot = diag + axis || 1
  mean /= n || 1
  hfs.sort((a, b) => a - b)
  return {
    hf: hf / n,
    mf: mf / n,
    sparkle: sp / n,
    sparkle2: sp2 / n,
    sat: sat / n,
    chromaHf: chroma / n,
    diag: diag / tot,
    axis: axis / tot,
    mean,
    std: Math.sqrt(Math.max(0, sq / n - mean * mean)),
    fineRatio: hf / (mf || 1),
    edge98: hfs[Math.floor(hfs.length * 0.98)] ?? 0,
    hfMed: hfs[hfs.length >> 1] ?? 0
  }
}
