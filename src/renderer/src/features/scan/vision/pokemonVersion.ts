// Which version of a Pokémon card (Normal, Reverse Holofoil, Holofoil...) the foil shows, named
// only when it is decisive: a range across the versions is always an acceptable answer.
import type { ScanProfile } from '@shared/scan/profiles'
import {
  VERSION_ART_FOIL_MIN,
  VERSION_FRAME_PLAIN_MAX,
  VERSION_OTHER_RATIO,
  VERSION_REFERENCE_RATIO
} from '@shared/scan/thresholds'
import type { RgbaImage } from '@shared/scan/types'
import { texture } from './foil'

export interface VersionCues {
  /** Texture of the frame strips: a reverse holo's foil shines across the frame. */
  frame: number
  /** Texture of the art window: a holo's foil shines on the art. */
  art: number
  /** Texture of the text box, the same card's yardstick for noise and detailed print. */
  reference: number
  /** The "1st Edition" stamp; never read yet, so a 1st Edition version is never named from it. */
  firstEdition: 'unknown'
}

/**
 * The foil cues of an upright, straightened card (842x1228), measured like Yu-Gi-Oh's surface
 * (vision/foil.ts), all as the median fine texture; null for a game with no foil boxes.
 */
export function pokemonVersionCues(card: RgbaImage, profile: ScanProfile): VersionCues | null {
  if (!profile.foil) return null
  const strips = profile.foil.frame.map((box) => texture(card, box).floor)
  return {
    frame: strips.reduce((a, b) => a + b, 0) / strips.length,
    art: texture(card, profile.foil.art).floor,
    reference: texture(card, profile.foil.reference).floor,
    firstEdition: 'unknown'
  }
}

/** The versions that carry no stamp; any other label (1st Edition, a promo stamp) is never named. */
const UNSTAMPED = ['Normal', 'Holofoil', 'Reverse Holofoil']

/**
 * The label among options (the versions' labels) the cues name, or null. Foil on the art well
 * over a plain frame is Holofoil, and must also stand well over the card's text box, so noise or
 * detail across the card names nothing. Foil on the frame never names Reverse Holofoil: on real
 * photos a Normal card's frame reads as foil as often as a reverse holo's (a Normal Pawniard was
 * named Reverse Holofoil), so the price is left a range. A card with a stamped version among the
 * options is never named, as the stamp isn't read to tell it from its unstamped twin.
 */
export function pokemonVersion(cues: VersionCues | null, options: string[]): string | null {
  if (!cues || !options.every((o) => UNSTAMPED.includes(o))) return null
  const holo =
    cues.art >= VERSION_ART_FOIL_MIN &&
    cues.frame <= VERSION_FRAME_PLAIN_MAX &&
    cues.art >= cues.frame * VERSION_OTHER_RATIO &&
    cues.art >= cues.reference * VERSION_REFERENCE_RATIO
  return holo && options.includes('Holofoil') ? 'Holofoil' : null
}
