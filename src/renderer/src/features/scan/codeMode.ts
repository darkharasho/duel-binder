import type { GameId } from '@shared/games'
import type { Box } from '@shared/scan/regions'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import { parseSetCode } from '@shared/scan/setCode'
import { frameNumber } from '@shared/scan/onePieceNumber'
import { centreCrop, type CropRect } from './crop'
import type { RawSignals } from './engine'
import { findTextLine, maskLine, toBand, toGrayBand } from './vision/bands'

/**
 * Code mode's aim box on the 3:4 preview, as fractions of it: a wide, short strip across the
 * middle, the shape of a set code held close. The code's characters read anywhere from a tenth
 * to three quarters of its height (findTextLine), so it needn't be filled exactly.
 */
export const CODE_AIM: Box = [0.06, 0.43, 0.94, 0.57]

/** The games whose cards carry a code that names the printing on its own. */
export const CODE_MODE_GAMES: readonly GameId[] = ['ygo', 'op']

export const codeModeGame = (game: GameId): boolean => CODE_MODE_GAMES.includes(game)

/** The aim box in a width x height camera frame's pixels: within the part the preview shows. */
export function aimRect(width: number, height: number, aim: Box = CODE_AIM): CropRect {
  const shown = centreCrop(width, height)
  const [x0, y0, x1, y1] = aim
  const x = shown.x + Math.round(x0 * shown.width)
  const y = shown.y + Math.round(y0 * shown.height)
  return {
    x,
    y,
    width: Math.max(1, shown.x + Math.round(x1 * shown.width) - x),
    height: Math.max(1, shown.y + Math.round(y1 * shown.height) - y)
  }
}

/** Parts of the aim box whose longest line is read: all of it, its top and its bottom. */
const AIM_PARTS: readonly Box[] = [
  [0, 0, 1, 1],
  [0, 0, 1, 0.6],
  [0, 0.4, 1, 1]
]

/**
 * The longest line of text in `part` of img, as a box of img with half the line's height around it,
 * or null when there's none.
 */
function lineBox(img: RgbaImage, part: Box, scale: number): Box | null {
  const line = findTextLine(img, part, scale)
  if (!line) return null
  const x0 = Math.min(...line.blobs.map((b) => b.x0))
  const x1 = Math.max(...line.blobs.map((b) => b.x1)) + 1
  const y0 = Math.min(...line.blobs.map((b) => b.y0))
  const y1 = Math.max(...line.blobs.map((b) => b.y1)) + 1
  const pad = (y1 - y0) / 2
  const [px0, py0, px1, py1] = part
  const fx = (v: number): number =>
    px0 + (Math.min(line.width, Math.max(0, v)) / line.width) * (px1 - px0)
  const fy = (v: number): number =>
    py0 + (Math.min(line.height, Math.max(0, v)) / line.height) * (py1 - py0)
  return [fx(x0 - pad), fy(y0 - pad), fx(x1 + pad), fy(y1 + pad)]
}

/** The middle of the values in a (2r+1)² window around each pixel: glitter goes, strokes stay. */
function median(px: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(px.length)
  const hist = new Uint16Array(256)
  const half = ((2 * r + 1) * (2 * r + 1)) >> 1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      hist.fill(0)
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy)) * width
        for (let dx = -r; dx <= r; dx++) hist[px[yy + Math.min(width - 1, Math.max(0, x + dx))]]++
      }
      let seen = 0
      let v = 0
      while ((seen += hist[v]) <= half) v++
      out[y * width + x] = v
    }
  return out
}

/** The value below which `share` of px's values lie. */
function darkest(px: Uint8Array, share: number): number {
  const hist = new Uint32Array(256)
  for (const v of px) hist[v]++
  let cut = 0
  for (let seen = hist[0]; seen < share * px.length && cut < 255;) seen += hist[++cut]
  return cut
}

/** The rows y0..y1 and columns x0..x1 (exclusive) of a width-wide image. */
function cut(
  px: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Uint8Array {
  const out = new Uint8Array((x1 - x0) * (y1 - y0))
  for (let y = y0; y < y1; y++)
    out.set(px.subarray(y * width + x0, y * width + x1), (y - y0) * (x1 - x0))
  return out
}

const inked = (px: Uint8Array, at: number): Uint8Array =>
  Uint8Array.from(px, (v) => (v <= at ? 0 : 255))

/** Averages px (width x height) down to w x h, each output pixel the mean of the ones it covers. */
function shrink(px: Uint8Array, width: number, height: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const fx = width / w
  const fy = height / h
  for (let j = 0; j < h; j++) {
    const ya = Math.floor(j * fy)
    const yb = Math.max(ya + 1, Math.floor((j + 1) * fy))
    for (let i = 0; i < w; i++) {
      const xa = Math.floor(i * fx)
      const xb = Math.max(xa + 1, Math.floor((i + 1) * fx))
      let sum = 0
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) sum += px[y * width + x]
      out[j * w + i] = Math.round(sum / ((yb - ya) * (xb - xa)))
    }
  }
  return out
}

/** The aim box is worked on at most this tall: glitter and strokes keep their size to the box. */
const WORK_HEIGHT = 160
/** A cut-out line's letters are brought down to about this tall, tesseract's best size. */
const READ_TEXT_HEIGHT = 32

/** Shares of a part's pixels taken as ink to find the code's line in, darkest first. */
export const LINE_FIND_DARK = [0.1, 0.14, 0.18]
/** Shares of the cut-out line's pixels taken as ink for tesseract. */
export const LINE_READ_DARK = [0.2, 0.25]

/**
 * The aim box's code as ink on white with foil glitter taken out, darkest first: the box in
 * grayscale, median-filtered (glitter on a foil bar is light and dark specks a few pixels across,
 * which tesseract reads as letters and which join the letters in findTextLine's local-contrast
 * ink), then for each part of the box (AIM_PARTS) and each share in `find`, the darkest share of
 * the part taken as ink and its longest line found in it, and that line cut out with half its
 * height around it, its darkest share in `read` as ink. A code is printed in black, so it is the
 * darkest thing near it; how dark the rest is (the bar, a frame line, the text box) varies, so
 * several shares are tried. A line found again is cut out once.
 */
export function darkBands(
  img: RgbaImage,
  find: readonly number[] = LINE_FIND_DARK,
  read: readonly number[] = LINE_READ_DARK
): OcrBand[] {
  const full = new Uint8Array(img.width * img.height)
  for (let i = 0; i < full.length; i++)
    full[i] = Math.round(
      0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]
    )
  const f = Math.min(1, WORK_HEIGHT / img.height)
  const width = Math.max(1, Math.round(img.width * f))
  const height = Math.max(1, Math.round(img.height * f))
  const gray = f < 1 ? shrink(full, img.width, img.height, width, height) : full
  const smooth = median(gray, width, height, 1)
  const out: OcrBand[] = []
  const seen = new Set<string>()
  for (const share of find)
    for (const [fx0, fy0, fx1, fy1] of AIM_PARTS) {
      const px0 = Math.round(fx0 * width)
      const py0 = Math.round(fy0 * height)
      const pw = Math.round(fx1 * width) - px0
      const ph = Math.round(fy1 * height) - py0
      const part = cut(smooth, width, px0, py0, px0 + pw, py0 + ph)
      const at = darkest(part, share)
      const line = maskLine(
        Uint8Array.from(part, (v) => (v <= at ? 1 : 0)),
        pw,
        ph
      )
      if (!line.length) continue
      const y0 = Math.min(...line.map((b) => b.y0))
      const y1 = Math.max(...line.map((b) => b.y1)) + 1
      const pad = Math.round((y1 - y0) / 2)
      const x0 = Math.max(0, px0 + Math.min(...line.map((b) => b.x0)) - pad)
      const x1 = Math.min(width, px0 + Math.max(...line.map((b) => b.x1)) + 1 + pad)
      const top = Math.max(0, py0 + y0 - pad)
      const bottom = Math.min(height, py0 + y1 + pad)
      const key = [x0, top, x1, bottom].map((v) => Math.round(v / 8)).join()
      if (seen.has(key)) continue
      seen.add(key)
      let strip = cut(smooth, width, x0, top, x1, bottom)
      let sw = x1 - x0
      let sh = bottom - top
      const g = READ_TEXT_HEIGHT / (y1 - y0)
      if (g < 1) {
        const w = Math.max(1, Math.round(sw * g))
        const h = Math.max(1, Math.round(sh * g))
        strip = shrink(strip, sw, sh, w, h)
        sw = w
        sh = h
      }
      for (const r of read)
        out.push({ width: sw, height: sh, data: inked(strip, darkest(strip, r)) })
    }
  return out
}

/**
 * The aim box as OCR bands, the first that reads as a code being the one taken: the longest line
 * of text in each of AIM_PARTS, so a line of art or card text caught above or below the code
 * doesn't hide it, each cut out in grayscale (toGrayBand: a small code cut down to its ink, as
 * toBand does, loses letters on a dark or foil bar) and then as ink on white. A small box (a
 * low-resolution camera) is scaled up first.
 */
export function codeBands(img: RgbaImage): OcrBand[] {
  const scale = img.height < 120 ? 3 : img.height < 240 ? 2 : 1
  const seen = new Set<string>()
  const boxes = AIM_PARTS.map((part) => lineBox(img, part, scale)).filter((b): b is Box => {
    if (b === null) return false
    // The same line found in two parts (the code alone in the box) is read once.
    const key = b.map((v) => v.toFixed(2)).join()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [
    ...boxes.map((b) => toGrayBand(img, b, scale)),
    ...boxes.map((b) => toBand(img, b, scale))
  ].filter((b) => b.width > 0 && b.height > 0)
}

/** The code a read names, in the game's own form ("LOCR-JP001", "OP05-119"); null for none. */
export function readCode(game: GameId, text: string): string | null {
  if (game === 'op') return frameNumber([text])
  return parseSetCode(text)
}

/** A frame that showed only its code: what resolveSignals names a card by, with no art. */
export const codeSignals = (texts: string[]): RawSignals => ({
  found: true,
  quad: null,
  art: [],
  codeTexts: texts,
  nameTexts: [],
  textBands: [],
  cues: null,
  look: null
})

/** Reads in a row a code must give before it's taken: one misread frame never adds a card. */
export const CODE_NEED = 2
/** Reads in a row without the code just taken before it may be taken again: it left the box. */
export const CODE_GONE_AFTER = 3

/**
 * Which reads add a card: a code once it reads CODE_NEED times running, and the code just taken
 * not again until it has been out of the box for CODE_GONE_AFTER reads (another code, or none).
 * So holding a card still adds it once, and the next card's code adds at once.
 */
export function createCodeGate(
  need = CODE_NEED,
  goneAfter = CODE_GONE_AFTER
): {
  /** A read's code, or null for none; the code to take now, else null. */
  push(code: string | null): string | null
  /** Forget the code just taken, so it may be taken again (the row was removed). */
  forget(): void
} {
  let run: string | null = null
  let count = 0
  let taken: string | null = null
  let away = 0
  return {
    push(code) {
      if (taken !== null) {
        away = code === taken ? 0 : away + 1
        if (away >= goneAfter) taken = null
      }
      if (code === null || code !== run) {
        run = code
        count = code === null ? 0 : 1
      } else count++
      if (code === null || count < need || code === taken) return null
      taken = code
      away = 0
      return code
    },
    forget() {
      taken = null
      run = null
      count = 0
    }
  }
}
