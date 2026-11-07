import { decode, encode } from 'jpeg-js'
import type { RgbaImage } from './scan/types'

/**
 * img stood upright: a landscape image turned a quarter counter-clockwise. A LEGEND half is a
 * portrait card whose art runs sideways across it and its other half; TCGplayer photographs it
 * wider than tall, with the text level, while TCGdex stores it as the card stands (the same turn).
 */
export function upright(img: RgbaImage): RgbaImage {
  const { width: w, height: h } = img
  if (w <= h) return img
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < w; y++)
    for (let x = 0; x < h; x++) {
      const from = (x * w + (w - 1 - y)) * 4
      data.set(img.data.subarray(from, from + 4), (y * h + x) * 4)
    }
  return { width: h, height: w, data }
}

/** A JPEG's width and height from its frame header, without decoding it; null when there is none. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    if (marker === 0xff) {
      i++ // fill byte
      continue
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    // SOF0–SOF15, less DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8]
      }
    }
    if (marker === 0xda || length < 2) return null // scan data before any frame header
    i += 2 + length
  }
  return null
}

/**
 * The JPEG stood upright (see upright), re-encoded; null when it is already portrait or can't be
 * read. Only the header is read for a portrait image, so passing every card image through is cheap.
 */
export function uprightJpeg(bytes: Uint8Array, quality = 90): Uint8Array | null {
  const size = jpegSize(bytes)
  if (!size || size.width <= size.height) return null
  let img: RgbaImage
  try {
    img = decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 })
  } catch {
    return null
  }
  const turned = upright(img)
  // jpeg-js hands its output to Buffer.from, which a Worker has no Buffer for: lend it a stand-in
  // for this one synchronous call.
  const g = globalThis as { Buffer?: unknown }
  const lent = g.Buffer === undefined
  if (lent) g.Buffer = { from: (a: ArrayLike<number>) => Uint8Array.from(a) }
  try {
    const out = encode({ width: turned.width, height: turned.height, data: turned.data }, quality)
    return new Uint8Array(out.data)
  } catch {
    return null
  } finally {
    if (lent) delete g.Buffer
  }
}
