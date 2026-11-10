import type { GameId } from '@shared/games'
import type { Box } from '@shared/scan/regions'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import { parseSetCode } from '@shared/scan/setCode'
import { frameNumber } from '@shared/scan/onePieceNumber'
import { centreCrop, type CropRect } from './crop'
import type { RawSignals } from './engine'
import { findTextLine, toBand, toGrayBand } from './vision/bands'

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
