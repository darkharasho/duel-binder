// Which version of a Pokémon card (Normal, Reverse Holofoil, Holofoil...) the foil shows, named
// only when it is decisive: a range across the versions is always an acceptable answer.
import type { ScanProfile } from '@shared/scan/profiles'
import {
  VERSION_ART_FOIL_MIN,
  VERSION_ART_PLAIN_MAX,
  VERSION_FRAME_FOIL_MIN,
  VERSION_FRAME_PLAIN_MAX
} from '@shared/scan/thresholds'
import type { RgbaImage } from '@shared/scan/types'
import { texture } from './foil'

export interface VersionCues {
  /** Texture of the frame strips: a reverse holo's foil shines across the frame. */
  frame: number
  /** Texture of the art window: a holo's foil shines on the art. */
  art: number
  /** The "1st Edition" stamp; never read yet, so a 1st Edition version is never named from it. */
  firstEdition: 'unknown'
}

/**
 * The foil cues of an upright, straightened card (842x1228), measured like Yu-Gi-Oh's surface
 * (vision/foil.ts); null for a game with no foil boxes.
 */
export function pokemonVersionCues(card: RgbaImage, profile: ScanProfile): VersionCues | null {
  if (!profile.foil) return null
  const strips = profile.foil.frame.map((box) => texture(card, box).floor)
  return {
    frame: strips.reduce((a, b) => a + b, 0) / strips.length,
    art: texture(card, profile.foil.art).coarse,
    firstEdition: 'unknown'
  }
}

/**
 * The label among options (the versions' labels) the cues name, or null. Foil on the frame over
 * flat art is Reverse Holofoil; foil on the art over a plain frame is Holofoil. A version with a
 * "1st Edition" twin among the options is never named, as the stamp can't tell them apart.
 */
export function pokemonVersion(cues: VersionCues | null, options: string[]): string | null {
  if (!cues) return null
  let label: string | null = null
  if (cues.frame >= VERSION_FRAME_FOIL_MIN && cues.art <= VERSION_ART_PLAIN_MAX)
    label = 'Reverse Holofoil'
  else if (cues.art >= VERSION_ART_FOIL_MIN && cues.frame <= VERSION_FRAME_PLAIN_MAX)
    label = 'Holofoil'
  if (label === null || !options.includes(label)) return null
  if (cues.firstEdition === 'unknown' && options.includes(`1st Edition ${label}`)) return null
  return label
}
