import { centreCrop, type CropRect } from '@/features/scan/crop'
import { findOpNumbers } from '@shared/scan/onePieceNumber'
import type { OcrBand } from '@shared/scan/types'

/**
 * The guide box on the preview the number is held in, as fractions of the preview: a small strip
 * in the middle, just big enough for the number. A wider one took in the card's type ("CP9") and
 * rarity badge, which tesseract ran into the number ("CP9517-0712O"), and made testers hold the
 * card nearly against the lens to fill it. On a 4K camera the number reads at a quarter of the
 * box's width (Dub's OP17-071 photo, 2026-11-05).
 */
export const SNAP_BOX = { left: 0.25, top: 0.45, width: 0.5, height: 0.1 } as const

/** Bands are scaled to at most this wide: tesseract reads a line no better any bigger. */
const MAX_WIDTH = 1200
/**
 * A small box (a 1080p phone camera's is about 540 px wide) is scaled up to MAX_WIDTH, up to this
 * many times: tesseract misses the number's small, soft digits at their own size.
 */
const MAX_UPSCALE = 2

/**
 * The video pixels under the guide box of a preview `viewW` x `viewH` that shows the video
 * object-cover, centred.
 */
export function snapRect(
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
  box: typeof SNAP_BOX = SNAP_BOX
): CropRect {
  const seen = centreCrop(videoW, videoH, viewW / viewH)
  return {
    x: Math.round(seen.x + box.left * seen.width),
    y: Math.round(seen.y + box.top * seen.height),
    width: Math.max(1, Math.round(box.width * seen.width)),
    height: Math.max(1, Math.round(box.height * seen.height))
  }
}

/** RGBA pixels as grayscale, one byte each. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): OcrBand {
  const data = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i++, p += 4)
    data[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8
  return { width, height, data }
}

/**
 * The band's grays stretched so its darkest and lightest few pixels go to black and white: a
 * number under a sleeve or in dim light is grey on grey, which tesseract reads as nothing.
 */
export function stretch(band: OcrBand): OcrBand {
  const { data } = band
  if (data.length === 0) return band
  const hist = new Uint32Array(256)
  for (const v of data) hist[v]++
  const cut = Math.floor(data.length * 0.02)
  let lo = 0
  for (let seen = 0; lo < 255 && seen + hist[lo] <= cut; lo++) seen += hist[lo]
  let hi = 255
  for (let seen = 0; hi > 0 && seen + hist[hi] <= cut; hi--) seen += hist[hi]
  if (hi - lo < 8) return band
  const out = new Uint8Array(data.length)
  const k = 255 / (hi - lo)
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - lo) * k
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : v
  }
  return { width: band.width, height: band.height, data: out }
}

/** Rows y0..y1 of a band. */
function rows(band: OcrBand, y0: number, y1: number): OcrBand {
  const height = y1 - y0
  return {
    width: band.width,
    height,
    data: band.data.slice(y0 * band.width, y1 * band.width)
  }
}

/**
 * The lines to read from the guide box's pixels: the whole box, and its upper and lower parts, so
 * a number that sits off-centre, or under a line of other text, still reads as one line.
 */
export function snapBands(band: OcrBand): OcrBand[] {
  const h = band.height
  const part = Math.round(h * 0.6)
  if (part < 8) return [band]
  return [band, rows(band, 0, part), rows(band, h - part, h)]
}

/**
 * The guide box's pixels off the live video: grayscale, contrast stretched, and scaled towards
 * MAX_WIDTH (up to MAX_UPSCALE times larger, never wider).
 */
export function grabSnap(video: HTMLVideoElement): OcrBand | null {
  const { videoWidth: vw, videoHeight: vh, clientWidth: cw, clientHeight: ch } = video
  if (!vw || !vh || !cw || !ch) return null
  const r = snapRect(vw, vh, cw, ch)
  const scale = Math.min(MAX_UPSCALE, MAX_WIDTH / r.width)
  const width = Math.max(1, Math.round(r.width * scale))
  const height = Math.max(1, Math.round(r.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, r.x, r.y, r.width, r.height, 0, 0, width, height)
  return stretch(toGray(ctx.getImageData(0, 0, width, height).data, width, height))
}

/** What a read of the guide box found. */
export type SnapResult = { number: string } | { problem: 'none' | 'many' }

/**
 * Reads the number held in the guide box: every One Piece number the lines read as, kept to the
 * ones the catalog has. One number is the answer; none or several is a problem to show.
 */
export async function readSnap(
  band: OcrBand,
  deps: {
    ocr(bands: OcrBand[]): Promise<string[]>
    prefixes: readonly string[] | undefined
    exists(number: string): Promise<boolean>
  }
): Promise<SnapResult> {
  const texts = await deps.ocr(snapBands(band))
  const found = [...new Set(texts.flatMap((t) => findOpNumbers(t, deps.prefixes)))]
  const known: string[] = []
  for (const n of found) if (await deps.exists(n).catch(() => false)) known.push(n)
  if (known.length === 1) return { number: known[0] }
  return { problem: known.length === 0 ? 'none' : 'many' }
}
