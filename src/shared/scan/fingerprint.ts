import type { RgbaImage } from './types'

export const HASH_WORDS = 8

const SIZE = 32
const KEEP = 16

/** cos table for the 32-point DCT-II: COS[u * SIZE + x]. */
const COS = new Float64Array(SIZE * SIZE)
for (let u = 0; u < SIZE; u++) {
  for (let x = 0; x < SIZE; x++)
    COS[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE))
}

/** Luminance of the image, area-averaged down (or up) to SIZE x SIZE. */
function lumaGrid(img: RgbaImage): Float64Array {
  const { width, height, data } = img
  const out = new Float64Array(SIZE * SIZE)
  const sx = width / SIZE
  const sy = height / SIZE
  for (let gy = 0; gy < SIZE; gy++) {
    const y0 = gy * sy
    const y1 = y0 + sy
    for (let gx = 0; gx < SIZE; gx++) {
      const x0 = gx * sx
      const x1 = x0 + sx
      let sum = 0
      let weight = 0
      for (let y = Math.floor(y0); y < Math.min(height, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        for (let x = Math.floor(x0); x < Math.min(width, Math.ceil(x1)); x++) {
          const w = wy * (Math.min(x + 1, x1) - Math.max(x, x0))
          const o = (y * width + x) * 4
          sum += w * (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2])
          weight += w
        }
      }
      out[gy * SIZE + gx] = weight > 0 ? sum / weight : 0
    }
  }
  return out
}

/**
 * 256-bit perceptual hash of an image: luminance, 32x32 area resize, 2D DCT-II,
 * then one bit per top-left 16x16 coefficient (set when above the median).
 */
export function artHash(img: RgbaImage): Uint32Array {
  const g = lumaGrid(img)
  // Rows first: tmp[y][u] for u < KEEP.
  const tmp = new Float64Array(SIZE * KEEP)
  for (let y = 0; y < SIZE; y++) {
    for (let u = 0; u < KEEP; u++) {
      let s = 0
      for (let x = 0; x < SIZE; x++) s += g[y * SIZE + x] * COS[u * SIZE + x]
      tmp[y * KEEP + u] = s
    }
  }
  const coef = new Float64Array(KEEP * KEEP)
  for (let v = 0; v < KEEP; v++) {
    for (let u = 0; u < KEEP; u++) {
      let s = 0
      for (let y = 0; y < SIZE; y++) s += tmp[y * KEEP + u] * COS[v * SIZE + y]
      coef[v * KEEP + u] = s
    }
  }
  const sorted = Array.from(coef).sort((a, b) => a - b)
  const median = (sorted[coef.length / 2 - 1] + sorted[coef.length / 2]) / 2
  const hash = new Uint32Array(HASH_WORDS)
  for (let i = 0; i < coef.length; i++) {
    if (coef[i] > median) hash[i >> 5] |= 1 << (i & 31)
  }
  return hash
}

function popcount(n: number): number {
  n -= (n >>> 1) & 0x55555555
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333)
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/** Hamming distance between the HASH_WORDS-word hashes starting at aOff in a and bOff in b. */
export function hamming(a: Uint32Array, aOff: number, b: Uint32Array, bOff: number): number {
  let d = 0
  for (let i = 0; i < HASH_WORDS; i++) d += popcount((a[aOff + i] ^ b[bOff + i]) >>> 0)
  return d
}

/**
 * Share of the height of YGOPRODeck's cropped Pendulum art that a printed card shows above its
 * Pendulum effect box. The cropped art is the whole picture, so only this top part is fingerprinted.
 */
export const PENDULUM_ART_VISIBLE = 0.58

/** The part of a card's cropped art to fingerprint: the visible top for Pendulum cards, else all of it. */
export function fingerprintSource(img: RgbaImage, frameType: string): RgbaImage {
  if (!frameType.includes('pendulum')) return img
  const height = Math.max(1, Math.round(img.height * PENDULUM_ART_VISIBLE))
  return { width: img.width, height, data: img.data.subarray(0, img.width * height * 4) }
}
