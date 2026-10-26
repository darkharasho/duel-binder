import type { RarityCues } from '@shared/scan/rarity'
import {
  NAME_INK_MAX_LEFT,
  NAME_INK_MIN_BLOBS,
  NAME_INK_MIN_DOMINANCE,
  NAME_INK_MIN_HEIGHT
} from '@shared/scan/thresholds'
import type { RgbaImage } from '@shared/scan/types'
import { findTextLine } from './bands'
import { NAME_BAND } from './regions'

/**
 * What a straightened, upright card shows of its foil: whether its name reads as ink darker or
 * lighter than the bar. A reading counts only when it is a line of text as tall as a name and
 * starting where names start, and far more of it than of the other ink, so a glint, a blurred
 * frame or a misplaced band reads as nothing.
 *
 * On webcam photos this is the cue that holds up. Sparkle in the art or across the card, which
 * would tell Super from Common or Starlight from Secret, is lost to the camera's blur and JPEG.
 */
export function rarityCues(card: RgbaImage): RarityCues {
  const line = findTextLine(card, NAME_BAND, 1)
  if (!line || line.blobs.length < NAME_INK_MIN_BLOBS) return { nameInk: null }
  const left = Math.min(...line.blobs.map((b) => b.x0))
  const top = Math.min(...line.blobs.map((b) => b.y0))
  const bottom = Math.max(...line.blobs.map((b) => b.y1))
  const fits =
    left <= NAME_INK_MAX_LEFT * line.width &&
    bottom - top + 1 >= NAME_INK_MIN_HEIGHT * line.height &&
    line.blobs.length >= NAME_INK_MIN_DOMINANCE * line.rivalBlobs
  return { nameInk: fits ? (line.sign === 1 ? 'dark' : 'light') : null }
}
