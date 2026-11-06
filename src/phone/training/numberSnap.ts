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

/** The guide box's pixels off the live video, grayscale and no wider than MAX_WIDTH. */
export function grabSnap(video: HTMLVideoElement): OcrBand | null {
  const { videoWidth: vw, videoHeight: vh, clientWidth: cw, clientHeight: ch } = video
  if (!vw || !vh || !cw || !ch) return null
  const r = snapRect(vw, vh, cw, ch)
  const scale = Math.min(1, MAX_WIDTH / r.width)
  const width = Math.max(1, Math.round(r.width * scale))
  const height = Math.max(1, Math.round(r.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, r.x, r.y, r.width, r.height, 0, 0, width, height)
  return toGray(ctx.getImageData(0, 0, width, height).data, width, height)
}

/** What a tap on Read number found. */
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
