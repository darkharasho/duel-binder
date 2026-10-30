import type { OcrBand, RgbaImage } from '@shared/scan/types'
import { crop, type Box } from './regions'

/** How much darker (or lighter) than its surroundings a pixel must be to count as ink, 0–255. */
const INK_CONTRAST = 12

const MAX_CHAR_BLOBS = 400

/** A line of text found in a band: its blobs, as pixel indexes into the band's width x height. */
export interface TextLine {
  width: number
  height: number
  /** Ink darker than its surroundings (1) or lighter (-1). */
  sign: 1 | -1
  blobs: Blob[]
  /** Blobs in the longest line of the other ink, 0 when it has none. */
  rivalBlobs: number
}

export interface Blob {
  x0: number
  y0: number
  x1: number
  y1: number
  pixels: number[]
}

/**
 * The longest line of text in box on a straightened card, scaled up `scale` times: dark ink or
 * light ink, whichever reads as more text. Null when there is none.
 */
export function findTextLine(img: RgbaImage, box: Box, scale = 2): TextLine | null {
  const { width, height, data: px } = grayScaled(crop(img, box), scale)
  stretch(px)
  const diff = localContrast(px, width, height, Math.max(4, Math.round(height / 4)))
  const [dark, light] = ([1, -1] as const).map((sign) => {
    const mask = new Uint8Array(width * height)
    for (let i = 0; i < mask.length; i++) mask[i] = sign * diff[i] < -INK_CONTRAST ? 1 : 0
    return textLine(blobs(mask, width, height), height)
  })
  if (!dark.length && !light.length) return null
  // Ties go to dark ink.
  return dark.length >= light.length
    ? { width, height, sign: 1, blobs: dark, rivalBlobs: light.length }
    : { width, height, sign: -1, blobs: light, rivalBlobs: dark.length }
}

/** A name line's ink, the ink dilated by 2 px (its halo), and the box around the line. */
export interface Strokes {
  ink: Uint8Array
  halo: Uint8Array
  x0: number
  x1: number
  y0: number
  y1: number
}

export function strokes(band: RgbaImage, line: TextLine): Strokes {
  const { width } = band
  const ink = new Uint8Array(width * band.height)
  let x0 = width
  let x1 = 0
  let y0 = band.height
  let y1 = 0
  for (const blob of line.blobs) {
    for (const p of blob.pixels) ink[p] = 1
    x0 = Math.min(x0, blob.x0)
    x1 = Math.max(x1, blob.x1)
    y0 = Math.min(y0, blob.y0)
    y1 = Math.max(y1, blob.y1)
  }
  // Dilated along rows, then columns: the colour a camera bleeds around thin strokes.
  const rows = new Uint8Array(ink.length)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let d = -2; d <= 2; d++) {
        const xx = x + d
        if (xx >= x0 && xx <= x1 && ink[y * width + xx]) {
          rows[y * width + x] = 1
          break
        }
      }
  const halo = new Uint8Array(ink.length)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      for (let d = -2; d <= 2; d++) {
        const yy = y + d
        if (yy >= y0 && yy <= y1 && rows[yy * width + x]) {
          halo[y * width + x] = 1
          break
        }
      }
  return { ink, halo, x0, x1, y0, y1 }
}

/**
 * How much darker a name line's ink is than the bar around it (the line's box less the ink and
 * its halo), in luma 0-1 as the camera gave it; negative when lighter. Null without ink or bar.
 */
export function inkContrast(band: RgbaImage, line: TextLine): number | null {
  if (!line.blobs.length) return null
  const { ink, halo, x0, x1, y0, y1 } = strokes(band, line)
  const { width, data } = band
  let inkL = 0
  let inks = 0
  let barL = 0
  let bars = 0
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p = y * width + x
      const l = 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2]
      if (ink[p]) {
        inkL += l
        inks++
      } else if (!halo[p]) {
        barL += l
        bars++
      }
    }
  return inks && bars ? (barL / bars - inkL / inks) / 255 : null
}

/**
 * The text in box on a straightened card, ready for OCR: cropped, grayscale, scaled up `scale`
 * times and contrast-stretched, then cut down to its longest line of text, drawn black on white
 * with the art and frame edges around it left out. Light text on a dark bar comes out black too.
 * Empty when no text is found. Pure, so the vision worker can use it.
 */
export function toBand(img: RgbaImage, box: Box, scale = 2): OcrBand {
  const found = findTextLine(img, box, scale)
  if (!found) return { width: 0, height: 0, data: new Uint8Array(0) }
  const { width, blobs: line } = found

  // The line on white, with a margin of half its height.
  const x0 = Math.min(...line.map((b) => b.x0))
  const y0 = Math.min(...line.map((b) => b.y0))
  const tall = Math.max(...line.map((b) => b.y1)) - y0 + 1
  const pad = Math.round(tall / 2)
  const outW = Math.max(...line.map((b) => b.x1)) - x0 + 1 + 2 * pad
  const outH = tall + 2 * pad
  const data = new Uint8Array(outW * outH).fill(255)
  for (const b of line)
    for (const p of b.pixels) {
      const x = (p % width) - x0 + pad
      const y = Math.floor(p / width) - y0 + pad
      data[y * outW + x] = 0
    }
  return { width: outW, height: outH, data }
}

/**
 * The block of text in box on a straightened card, for reading whole: cropped, grayscale and
 * contrast-stretched, at the card's own scale. Pure, so the vision worker can use it.
 */
export function toBlock(img: RgbaImage, box: Box): OcrBand {
  const { width, height, data: px } = grayScaled(crop(img, box), 1)
  stretch(px)
  return { width, height, data: Uint8Array.from(px, Math.round) }
}

/**
 * The block of text in box on a straightened card as ink on white, for reading whole: cropped,
 * grayscale, scaled up `scale` times and contrast-stretched, then each pixel black where it is
 * INK_CONTRAST darker than the mean around it. A webcam's small, soft text on a mottled or foil
 * box reads far better so than as it is. Pure, so the vision worker can use it.
 */
export function toInkBlock(img: RgbaImage, box: Box, scale = 2): OcrBand {
  const { width, height, data: px } = grayScaled(crop(img, box), scale)
  stretch(px)
  const diff = localContrast(px, width, height, INK_BLOCK_RADIUS * scale)
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = diff[i] < -INK_CONTRAST ? 0 : 255
  return { width, height, data }
}

/** The mean toInkBlock takes each pixel against is over a square this many pixels out, at scale 1. */
const INK_BLOCK_RADIUS = 10

/**
 * The blobs of the longest line of text: character-sized blobs whose centres line up, without a
 * gap wider than two characters, plus the small marks (dashes, dots) between them. A band with
 * more than MAX_CHAR_BLOBS character-sized blobs is texture, not text, and finds nothing (the
 * search is quadratic in them).
 */
function textLine(all: Blob[], height: number): Blob[] {
  const h = (b: Blob): number => b.y1 - b.y0 + 1
  const w = (b: Blob): number => b.x1 - b.x0 + 1
  const chars = all.filter(
    (b) =>
      h(b) >= 0.1 * height &&
      h(b) <= 0.75 * height &&
      w(b) <= 3 * h(b) &&
      b.pixels.length >= 0.1 * h(b) * w(b)
  )
  if (chars.length > MAX_CHAR_BLOBS) return []
  let best: Blob[] = []
  for (const seed of chars) {
    const cy = (seed.y0 + seed.y1) / 2
    const sh = h(seed)
    const row = chars
      .filter(
        (b) => Math.abs((b.y0 + b.y1) / 2 - cy) <= 0.35 * sh && h(b) >= sh / 2 && h(b) <= 2 * sh
      )
      .sort((a, b) => a.x0 - b.x0)
    let run: Blob[] = []
    let right = -Infinity
    for (const b of row) {
      if (b.x0 - right > 2 * sh) {
        if (run.length > best.length) best = run
        run = []
      }
      run.push(b)
      right = Math.max(right, b.x1)
    }
    if (run.length > best.length) best = run
  }
  if (best.length < 3) return []
  const y0 = Math.min(...best.map((b) => b.y0))
  const y1 = Math.max(...best.map((b) => b.y1))
  const lineH = y1 - y0 + 1
  const x0 = Math.min(...best.map((b) => b.x0)) - lineH
  const x1 = Math.max(...best.map((b) => b.x1)) + lineH
  const marks = all.filter(
    (b) =>
      !best.includes(b) &&
      b.y0 >= y0 - 0.2 * lineH &&
      b.y1 <= y1 + 0.2 * lineH &&
      b.x0 >= x0 &&
      b.x1 <= x1
  )
  return [...best, ...marks]
}

/** The 4-connected blobs of a 0/1 mask. */
function blobs(mask: Uint8Array, width: number, height: number): Blob[] {
  const seen = new Uint8Array(mask.length)
  const out: Blob[] = []
  const stack: number[] = []
  const visit = (p: number): void => {
    if (mask[p] && !seen[p]) {
      seen[p] = 1
      stack.push(p)
    }
  }
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    const b: Blob = { x0: width, y0: height, x1: 0, y1: 0, pixels: [] }
    visit(start)
    while (stack.length) {
      const p = stack.pop()!
      const x = p % width
      const y = (p - x) / width
      b.pixels.push(p)
      b.x0 = Math.min(b.x0, x)
      b.x1 = Math.max(b.x1, x)
      b.y0 = Math.min(b.y0, y)
      b.y1 = Math.max(b.y1, y)
      if (x > 0) visit(p - 1)
      if (x < width - 1) visit(p + 1)
      if (y > 0) visit(p - width)
      if (y < height - 1) visit(p + width)
    }
    out.push(b)
  }
  return out
}

/** Luma, scaled bilinearly. */
function grayScaled(
  src: RgbaImage,
  scale: number
): { width: number; height: number; data: Float32Array } {
  const gray = new Float32Array(src.width * src.height)
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4
    gray[i] = 0.299 * src.data[p] + 0.587 * src.data[p + 1] + 0.114 * src.data[p + 2]
  }
  const width = Math.round(src.width * scale)
  const height = Math.round(src.height * scale)
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.max(0, (y + 0.5) / scale - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(src.height - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.max(0, (x + 0.5) / scale - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(src.width - 1, x0 + 1)
      const fx = sx - x0
      const top = gray[y0 * src.width + x0] * (1 - fx) + gray[y0 * src.width + x1] * fx
      const bottom = gray[y1 * src.width + x0] * (1 - fx) + gray[y1 * src.width + x1] * fx
      data[y * width + x] = top * (1 - fy) + bottom * fy
    }
  }
  return { width, height, data }
}

/** Spreads the 1st to 99th percentile over 0–255 in place, so a stray glint doesn't flatten it. */
function stretch(px: Float32Array): void {
  const hist = new Uint32Array(256)
  for (const v of px) hist[Math.round(v)]++
  const percentile = (q: number): number => {
    let seen = 0
    for (let v = 0; v < 256; v++) if ((seen += hist[v]) >= q * px.length) return v
    return 255
  }
  const lo = percentile(0.01)
  const range = Math.max(1, percentile(0.99) - lo)
  for (let i = 0; i < px.length; i++)
    px[i] = Math.max(0, Math.min(255, ((px[i] - lo) / range) * 255))
}

/** Each pixel minus the mean of the (2r+1)² square around it, from a summed-area table. */
function localContrast(px: Float32Array, width: number, height: number, r: number): Float32Array {
  const stride = width + 1
  const sat = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += px[y * width + x]
      sat[(y + 1) * stride + x + 1] = sat[y * stride + x + 1] + row
    }
  }
  const diff = new Float32Array(px.length)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const sum =
        sat[y1 * stride + x1] -
        sat[y0 * stride + x1] -
        sat[y1 * stride + x0] +
        sat[y0 * stride + x0]
      diff[y * width + x] = px[y * width + x] - sum / ((x1 - x0) * (y1 - y0))
    }
  }
  return diff
}
