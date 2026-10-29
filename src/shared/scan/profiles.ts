// Where each game's card keeps what the scanner reads: its art, collector number or set code,
// name and rules text, as shares of the straightened card (warpCard's 842x1228).
import type { GameId } from '../games/types'
import { ART_BOXES, CODE_BANDS, NAME_BAND, TEXT_BOX, type Box } from './regions'

export type { Box }

export interface ScanProfile {
  game: GameId
  /** Where the art may sit, each tried in turn; the first is what a reference image is cut to. */
  artBoxes: readonly Box[]
  /**
   * The art windows' printed borders, which tell a card's outline from other card-shaped lines
   * in the frame (each tried either way up).
   */
  windows: readonly Box[]
  /** Where the set code or collector number may be read. */
  codeBands: readonly Box[]
  nameBand: Box
  /** The rules text, read whole to tell the card's language. */
  textBox: Box
  /** Whether the Yu-Gi-Oh rarity cues and look model run on the card. */
  rarityLook: boolean
  /**
   * Where a version's foil shows, when the game prices versions by it: strips of frame (a reverse
   * holo's foil covers them, a holo's doesn't), the art window (a holo's foil covers it) and a
   * reference region on the same card, to tell foil from sensor noise and detailed print.
   */
  foil: { frame: readonly Box[]; art: Box; reference: Box } | null
}

/**
 * Pokémon (63 x 88 mm, a little wider than the warp's 59 x 86, which only stretches it a few
 * percent). Measured on TCGdex's high.jpg renders of a Scarlet & Violet Pokémon and Trainer
 * (sv03 045, sv01 196), a Japanese card (SV1S 001), a Sword & Shield Trainer (swsh1 180), base
 * set Charizard (base1 4), an XY full art (xy1 1) and two Special Illustration Rares (sv03 215,
 * sv03.5 199). The art window starts lower on Trainers (0.14) than on Pokémon (0.10), and ends
 * lower too (0.52 against 0.47): the art box is what both share, so it's all art on every
 * normal card. Full arts have no window; the same box is just part of the art there, and the
 * reference is cut to the same box, so it matches all the same.
 */
const PKM_ART = [0.1, 0.14, 0.9, 0.47] as const satisfies Box

export const SCAN_PROFILES: Record<GameId, ScanProfile> = {
  ygo: {
    game: 'ygo',
    artBoxes: Object.values(ART_BOXES),
    windows: Object.values(ART_BOXES),
    codeBands: CODE_BANDS,
    nameBand: NAME_BAND,
    textBox: TEXT_BOX,
    rarityLook: true,
    foil: null
  },
  pkm: {
    game: 'pkm',
    artBoxes: [PKM_ART],
    // The art window's printed border, by layout, measured on TCGdex renders.
    windows: [
      // Scarlet & Violet, Mega Evolution, Sword & Shield and EX Pokémon (sv03 045, me05 050).
      [0.077, 0.097, 0.925, 0.473],
      // Scarlet & Violet and Sword & Shield Trainers (sv01 196, me05 079, swsh1 180).
      [0.078, 0.139, 0.927, 0.524],
      // Sun & Moon Pokémon and Trainers (sm1 1, sm1 120).
      [0.057, 0.081, 0.94, 0.476],
      [0.055, 0.125, 0.94, 0.522],
      // Black & White and Diamond & Pearl Pokémon (bw1 1, dp1 1).
      [0.08, 0.097, 0.92, 0.5],
      // Base set and Neo (base1 4, neo1 1).
      [0.108, 0.117, 0.89, 0.515],
      // XY Trainers (xy1 120).
      [0.097, 0.156, 0.9, 0.524]
    ],
    codeBands: [
      // The collector number ("045/197", after the regulation mark and set badge), bottom left on
      // Sword & Shield and later cards, Japanese ones included: 0.94–0.968, between the
      // illustrator's line above and the copyright below.
      [0.03, 0.932, 0.42, 0.976],
      // Bottom right, where base set to Sun & Moon cards print it ("4/102", "1/146"), right of
      // the illustrator.
      [0.72, 0.935, 0.98, 0.985]
    ],
    // The name, top left, after the stage badge (0.03–0.09), stopping short of "Evolves from"
    // under it on Scarlet & Violet cards and of the HP, from 0.64 on base set cards. Trainers'
    // names sit lower (0.075–0.115, under the TRAINER header) and base set's at 0.06–0.11, so
    // those aren't read: their art is matched all the same.
    nameBand: [0.04, 0.02, 0.64, 0.09],
    // Attacks and abilities, between the art (or the Pokédex strip under it) and the weakness bar.
    textBox: [0.07, 0.57, 0.93, 0.8],
    rarityLook: false,
    foil: {
      // The card's side borders, between its edge and the art window (which starts at 0.08–0.1).
      frame: [
        [0.04, 0.2, 0.075, 0.88],
        [0.925, 0.2, 0.96, 0.88]
      ],
      art: PKM_ART,
      // The attacks' text, like textBox.
      reference: [0.07, 0.57, 0.93, 0.8]
    }
  }
}

export function scanProfile(game: GameId): ScanProfile {
  return SCAN_PROFILES[game]
}
