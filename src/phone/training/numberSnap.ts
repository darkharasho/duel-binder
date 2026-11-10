import { centreCrop, type CropRect } from '@/features/scan/crop'
import { findOpNumbers } from '@shared/scan/onePieceNumber'
import type { OcrBand } from '@shared/scan/types'

/**
 * The guide box on the preview the number is held in, as fractions of the preview: a small strip
 * in the middle, just big enough for the number. A wider one took in the card's type ("CP9") and
 * rarity badge, which tesseract ran into the number ("CP9517-0712O"), and made testers hold the
 * card nearly against the lens to fill it. On a 4K camera the number reads at a quarter of the
 * box's width (Dub's OP17-071 photo, 2026-11-05). The phone reads PHONE_SNAP_GROW times the
 * drawn box, so a hand's wobble doesn't move the number out of what is read; the bands
 * (snapBands) keep the wider area's other text off the number's line, and the catalog check
 * (readSnap) drops what isn't a number.
 */
export const SNAP_BOX = { left: 0.25, top: 0.45, width: 0.5, height: 0.1 } as const

/** How many times the drawn guide box, in each direction, the phone reads (2026-11-10). */
export const PHONE_SNAP_GROW = 1.5

/** Bands are scaled to at most this wide: tesseract reads a line no better any bigger. */
const MAX_WIDTH = 1200
/**
 * A small box (a 1080p phone camera's is about 540 px wide) is scaled up to MAX_WIDTH, up to this
 * many times: tesseract misses the number's small, soft digits at their own size.
 */
const MAX_UPSCALE = 2

/**
 * The video pixels under the guide box of a preview `viewW` x `viewH` that shows the video
 * object-cover, centred; with `grow`, a box that many times as wide and tall about the same
 * centre, kept inside what the preview shows.
 */
export function snapRect(
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
  box: { left: number; top: number; width: number; height: number } = SNAP_BOX,
  grow = 1
): CropRect {
  const seen = centreCrop(videoW, videoH, viewW / viewH)
  const w = Math.min(1, box.width * grow)
  const h = Math.min(1, box.height * grow)
  const left = Math.min(1 - w, Math.max(0, box.left + box.width / 2 - w / 2))
  const top = Math.min(1 - h, Math.max(0, box.top + box.height / 2 - h / 2))
  return {
    x: Math.round(seen.x + left * seen.width),
    y: Math.round(seen.y + top * seen.height),
    width: Math.max(1, Math.round(w * seen.width)),
    height: Math.max(1, Math.round(h * seen.height))
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
 *
 * A box read `grow` times larger than the drawn one has a line of other text above or below the
 * number more often, which tesseract (one line at a time) runs together; its lines are instead the
 * drawn box's rows (first) and bands as tall at the top and the bottom, so any line up to half
 * the area's height sits whole in one of them.
 */
export function snapBands(band: OcrBand, grow = 1): OcrBand[] {
  const h = band.height
  if (grow > 1) {
    const part = Math.round(h / grow)
    if (part < 8) return [band]
    const mid = Math.round((h - part) / 2)
    return [rows(band, mid, mid + part), rows(band, 0, part), rows(band, h - part, h)]
  }
  const part = Math.round(h * 0.6)
  if (part < 8) return [band]
  return [band, rows(band, 0, part), rows(band, h - part, h)]
}

/**
 * How sharp a band is: the mean squared Laplacian over every `step`th pixel each way. Blur (a
 * hand's wobble, focus hunting) takes the fine edges out of the digits, and this falls with them.
 * Only comparable between frames of the same scene; see createSharpnessGate.
 */
export function sharpness(band: OcrBand, step = 2): number {
  const { width: w, height: h, data } = band
  let sum = 0
  let n = 0
  for (let y = 1; y < h - 1; y += step) {
    const row = y * w
    for (let x = 1; x < w - 1; x += step) {
      const i = row + x
      const lap = data[i - 1] + data[i + 1] + data[i - w] + data[i + w] - 4 * data[i]
      sum += lap * lap
      n++
    }
  }
  return n === 0 ? 0 : sum / n
}

/**
 * Lets through frames that are sharp next to the last few, so OCR isn't spent on a blurred one.
 * There is no fixed threshold: a frame passes at `ratio` of the sharpest of the last `window`
 * frames (every camera and light differs), the first few always pass, and after `maxSkips`
 * frames skipped in a row the next is read anyway, so a soft camera is never locked out.
 */
export function createSharpnessGate(
  o: { ratio?: number; window?: number; maxSkips?: number; warmup?: number } = {}
): { pass(sharpness: number): boolean; reset(): void } {
  const ratio = o.ratio ?? 0.5
  const window = o.window ?? 8
  const maxSkips = o.maxSkips ?? 3
  const warmup = o.warmup ?? 2
  let recent: number[] = []
  let skipped = 0
  return {
    pass(s) {
      const best = recent.length > 0 ? Math.max(...recent) : 0
      const enough = recent.length >= warmup
      recent.push(s)
      if (recent.length > window) recent.shift()
      if (!enough || s >= best * ratio || skipped >= maxSkips) {
        skipped = 0
        return true
      }
      skipped++
      return false
    },
    reset() {
      recent = []
      skipped = 0
    }
  }
}

/**
 * The number `need` of the last `of` reads agree on, or null. A wobbly or empty frame between
 * two good reads doesn't start the count over, as "twice in a row" did.
 */
export function createVote(need = 2, of = 3): { push(read: string | null): string | null } {
  const last: (string | null)[] = []
  return {
    push(read) {
      last.push(read)
      if (last.length > of) last.shift()
      const counts = new Map<string, number>()
      for (const r of last) if (r !== null) counts.set(r, (counts.get(r) ?? 0) + 1)
      // The newest read first, then whichever number still holds the window.
      if (read !== null && (counts.get(read) ?? 0) >= need) return read
      for (const [n, c] of counts) if (c >= need) return n
      return null
    }
  }
}

/**
 * The guide box's pixels (`grow` times it, see snapRect) off the live video: grayscale, contrast
 * stretched, and scaled towards MAX_WIDTH (up to MAX_UPSCALE times larger, never wider).
 */
export function grabSnap(video: HTMLVideoElement, grow = 1): OcrBand | null {
  const { videoWidth: vw, videoHeight: vh, clientWidth: cw, clientHeight: ch } = video
  if (!vw || !vh || !cw || !ch) return null
  const r = snapRect(vw, vh, cw, ch, SNAP_BOX, grow)
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

/**
 * What a read of the guide box found. 'blurry': the frame was skipped before OCR (the phone's
 * reading loop only).
 */
export type SnapResult = { number: string } | { problem: 'none' | 'many' | 'blurry' }

/**
 * Reads the number held in the guide box: every One Piece number the lines read as, kept to the
 * ones the catalog has. One number is the answer; none or several is a problem to show.
 *
 * A box read `grow` times larger (the phone's) reads the drawn box's rows first, and a catalog
 * number there is the answer without the other two bands' OCR.
 */
export async function readSnap(
  band: OcrBand,
  deps: {
    ocr(bands: OcrBand[]): Promise<string[]>
    prefixes: readonly string[] | undefined
    exists(number: string): Promise<boolean>
    grow?: number
  }
): Promise<SnapResult> {
  const grow = deps.grow ?? 1
  const bands = snapBands(band, grow)
  const knownIn = async (texts: string[]): Promise<string[]> => {
    const found = [...new Set(texts.flatMap((t) => findOpNumbers(t, deps.prefixes)))]
    const known: string[] = []
    for (const n of found) if (await deps.exists(n).catch(() => false)) known.push(n)
    return known
  }
  let known: string[]
  if (grow > 1 && bands.length > 1) {
    known = await knownIn(await deps.ocr(bands.slice(0, 1)))
    if (known.length !== 1) {
      const more = await knownIn(await deps.ocr(bands.slice(1)))
      known = [...new Set([...known, ...more])]
    }
  } else known = await knownIn(await deps.ocr(bands))
  if (known.length === 1) return { number: known[0] }
  return { problem: known.length === 0 ? 'none' : 'many' }
}
