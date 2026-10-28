import type { NameTint, RarityCues } from '@shared/scan/rarity'
import {
  NAME_GOLD_HUES,
  NAME_GOLD_MIN_HUE_GAP,
  NAME_GOLD_MIN_SATURATION,
  NAME_INK_MAX_LEFT,
  NAME_INK_MIN_BLOBS,
  NAME_INK_MIN_DOMINANCE,
  NAME_INK_MIN_HEIGHT,
  NAME_SILVER_MAX_SATURATION,
  NAME_SILVER_MAX_SATURATION_RATIO,
  NAME_SILVER_MIN_HUE_SPREAD
} from '@shared/scan/thresholds'
import type { RgbaImage } from '@shared/scan/types'
import { findTextLine, type TextLine } from './bands'
import { surface } from './foil'
import { crop, NAME_BAND } from './regions'

const NOTHING: RarityCues = { nameInk: null, nameTint: null }

/** Pixels below this saturation have no hue worth counting in the spread. */
const HUED = 0.2

/** Hue in degrees and saturation 0–1. */
function hueSat(r: number, g: number, b: number): [number, number] {
  const max = Math.max(r, g, b)
  const chroma = max - Math.min(r, g, b)
  if (!chroma) return [0, 0]
  const h =
    max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  return [(h * 60 + 360) % 360, chroma / max]
}

const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

/**
 * The colour of the line's ink against the bar around it (the rest of the line's box). Gold and
 * silver are told by colour alone; whether the ink reads light or dark is the caller's.
 */
function tintOf(band: RgbaImage, line: TextLine): NameTint | null {
  const ink = new Set(line.blobs.flatMap((b) => b.pixels))
  const x0 = Math.min(...line.blobs.map((b) => b.x0))
  const x1 = Math.max(...line.blobs.map((b) => b.x1))
  const y0 = Math.min(...line.blobs.map((b) => b.y0))
  const y1 = Math.max(...line.blobs.map((b) => b.y1))
  const sums = { ink: [0, 0, 0, 0], bar: [0, 0, 0, 0] }
  let sx = 0
  let sy = 0
  let hued = 0
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p = y * band.width + x
      const [r, g, b] = band.data.subarray(p * 4, p * 4 + 3)
      const sum = ink.has(p) ? sums.ink : sums.bar
      sum[0] += r
      sum[1] += g
      sum[2] += b
      sum[3]++
      if (sum !== sums.ink) continue
      const [h, s] = hueSat(r, g, b)
      if (s < HUED) continue
      sx += Math.cos((h * Math.PI) / 180)
      sy += Math.sin((h * Math.PI) / 180)
      hued++
    }
  if (!sums.ink[3] || !sums.bar[3]) return null
  const mean = ([r, g, b, n]: number[]): number[] => [r / n, g / n, b / n]
  const [ir, ig, ib] = mean(sums.ink)
  const [br, bg, bb] = mean(sums.bar)
  const [inkHue, inkSat] = hueSat(ir, ig, ib)
  const [barHue, barSat] = hueSat(br, bg, bb)
  const gold =
    inkHue >= NAME_GOLD_HUES[0] &&
    inkHue <= NAME_GOLD_HUES[1] &&
    inkSat >= NAME_GOLD_MIN_SATURATION &&
    (barSat < HUED || hueGap(inkHue, barHue) >= NAME_GOLD_MIN_HUE_GAP)
  if (gold) return 'gold'
  const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b
  const spread = hued ? 1 - Math.hypot(sx, sy) / hued : 0
  const silver =
    luma(ir, ig, ib) > luma(br, bg, bb) &&
    (inkSat <= NAME_SILVER_MAX_SATURATION_RATIO * barSat ||
      inkSat <= NAME_SILVER_MAX_SATURATION ||
      spread >= NAME_SILVER_MIN_HUE_SPREAD)
  return silver ? 'silver' : null
}

/**
 * What a straightened, upright card shows of its foil: how its name reads (nameCues) and how
 * textured its frame is beside the artwork against its effect text (surface), which tells a
 * card foil all over, such as a Starlight, from one whose frame is plain card stock.
 */
export function rarityCues(card: RgbaImage): RarityCues {
  return { ...nameCues(card), surface: surface(card) }
}

/**
 * Whether a card's name reads as ink darker or lighter than the bar, and whether that ink is
 * gold or silver. A reading counts only when it is a line of text as tall as a name and starting
 * where names start, and far more of it than of the other ink, so a glint, a blurred frame or a
 * misplaced band reads as nothing. On webcam frames the ink's colour is mostly the bar's (the
 * camera keeps colour at a quarter of the resolution), so gold is seldom told.
 */
function nameCues(card: RgbaImage): RarityCues {
  const line = findTextLine(card, NAME_BAND, 1)
  if (!line || line.blobs.length < NAME_INK_MIN_BLOBS) return NOTHING
  const left = Math.min(...line.blobs.map((b) => b.x0))
  const top = Math.min(...line.blobs.map((b) => b.y0))
  const bottom = Math.max(...line.blobs.map((b) => b.y1))
  const fits =
    left <= NAME_INK_MAX_LEFT * line.width &&
    bottom - top + 1 >= NAME_INK_MIN_HEIGHT * line.height &&
    line.blobs.length >= NAME_INK_MIN_DOMINANCE * line.rivalBlobs
  if (!fits) return NOTHING
  return {
    nameInk: line.sign === 1 ? 'dark' : 'light',
    nameTint: tintOf(crop(card, NAME_BAND), line)
  }
}
