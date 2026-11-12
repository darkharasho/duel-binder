// Where each game's card keeps what the scanner reads: its art, collector number or set code,
// name and rules text, as shares of the straightened card (warpCard's 842x1228).
import type { GameId } from '../games/types'
import { ART_BOXES, CODE_BANDS, INNER_FRAME, NAME_BAND, TEXT_BOX, type Box } from './regions'

export type { Box }

/**
 * A quad the candidate finder builds: short side over long side, how far off it may be, and the
 * least share of the frame it covers.
 */
export interface QuadShape {
  aspect: number
  tolerance: number
  minArea: number
}

export interface ScanProfile {
  game: GameId
  /** Where the art may sit, each tried in turn; the first is what a reference image is cut to. */
  artBoxes: readonly Box[]
  /**
   * The art windows' printed borders, which tell a card's outline from other card-shaped lines
   * in the frame (each tried either way up).
   */
  windows: readonly Box[]
  /**
   * Whether the art box is also tried where one of the windows is found on the card
   * (artWindow.ts): a few percent off, the art hash says nothing.
   */
  windowArt: boolean
  /**
   * Printed frames inside the card that a candidate outline may be instead of the card: when no
   * candidate's art matches, the card around each is tried as if it were one of these.
   */
  innerFrames: readonly Box[]
  /** The art window's shape on a real card, when quads of it are looked for too (innerFrames). */
  windowShape: QuadShape | null
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
  /**
   * Whether a frame whose art matched nothing is searched again (candidates.ts): the closest few
   * outlines matched at full size, and the line and quad search run again inside each holder or
   * card-sized region found, cut from the full-size frame (holderSearch.ts).
   */
  holderSearch: boolean
  /**
   * Whether a frame tries the outline the last frame's art matched on before searching: a card
   * stays where it is between frames, and the search is most of a frame's cost.
   */
  keepOutline: boolean
  /**
   * Whether code bands are handed to OCR as grayscale crops (toGrayBand) rather than cut down to
   * their line of ink (toBand): a small, soft, light number on a coloured bar reads far better so.
   */
  codeGray?: boolean
  /**
   * How far past the outline code bands may reach, as a share of the card's width and height
   * (0 when left out). An outline found without art can stop at a printed bar's edge a few
   * percent short of the card's end, which puts a number printed near that end outside it; with
   * a reach, code bands may run past 0 or 1 by up to this much.
   */
  codeReach?: number
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

/** The art window's printed border, by layout, measured on TCGdex renders. */
const PKM_WINDOWS: readonly Box[] = [
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
]

/**
 * The art panels of the two-card "spread" Stadiums (Delta Reign's Legendary Pyroduct, Summit and
 * Trench, me06 094-099): the art runs to the edge where the halves join, inside a silver frame,
 * so the panel is itself about a card's shape (0.71) and is often found in place of the card.
 * Left half (094, 096, 098), then right half (095, 097, 099); measured on TCGdex's renders.
 */
const PKM_SPREAD_PANELS: readonly Box[] = [
  [0.19, 0.135, 1, 0.955],
  [0, 0.135, 0.81, 0.955]
]

/**
 * One Piece (63 x 88 mm, like Pokémon). Its art and number are matched by the scanner
 * (resolveOnePiece.ts) and its number read by the Contribute photos screen too; the name and
 * text are where Bandai prints them, the text box read only to tell English from Japanese. Measured on Bandai's renders
 * (en.onepiece-cardgame.com, 600 x 838): a Leader, Characters, an Event and a Stage, a promo, a
 * premium booster, an alternate art, a manga SP and a full-art SEC. Every layout prints the number
 * in the same place, bottom right, right-aligned against the rarity box: 0.755 (PRB01-001) or
 * 0.81 (P-001) to 0.874 across, 0.945 to 0.963 down.
 */
const OP_PROFILE: ScanProfile = {
  game: 'op',
  // The art above Bandai's SAMPLE stamp. The reference art (Bandai's site) has SAMPLE across 0.42
  // to 0.57 of the card's height, which a printed card doesn't; the art below it, down to the
  // effect text at about 0.6, is left out. Against TCGplayer's stamp-free scans of OP-01 this put
  // the right card a median 6 bits away, against 36 for the whole card.
  artBoxes: [[0.06, 0.06, 0.94, 0.4]],
  // Cards are full art with no printed window, so outlines are scored by their own edges alone.
  windows: [],
  windowArt: false,
  // Printed lines a held card's outline is taken for, measured on the testers' Contribute photos
  // (in the card the art matched): the art panel, edge to edge between the cost and power bar and
  // the effect text; the white border's inside edge; and the card down to its name bar, whose
  // edge fingers on a held card's sides leave as the likeliest bottom. Each found one more card
  // of the 84 (78 to 81 right, no new wrong).
  innerFrames: [
    [0, 0.08, 1, 0.61],
    [0.04, 0.035, 0.955, 0.967],
    [0.03, 0, 0.98, 0.85]
  ],
  windowShape: null,
  codeBands: [
    // The number with room either way for an outline a few percent off (outlines found without
    // art run up to 3% inside the card's edge), which takes in the rarity box and part of the
    // block icon right of it (findOpNumbers reads past them).
    [0.735, 0.934, 0.93, 0.98],
    // The same number below an outline that stops at the bottom bar's top edge (0.93 to 0.95 of
    // the card), which fingers on a held card's long sides often leave as the likeliest outline.
    [0.735, 0.975, 0.95, 1.05]
  ],
  codeReach: 0.06,
  // Light numbers on coloured bars, about 15 px high on a 4K phone's frame.
  codeGray: true,
  // The name, over the traits bar.
  nameBand: [0.12, 0.875, 0.88, 0.925],
  textBox: [0.06, 0.6, 0.94, 0.83],
  rarityLook: false,
  foil: null,
  holderSearch: false,
  // No fingerprints, so no art match to keep an outline by.
  keepOutline: false
}

/**
 * Magic (63 x 88 mm). Measured with scripts/scan/mtg-regions.ts on Scryfall's `large` images
 * (672 x 936): 2015-frame cards (XLN 78 creature, WHO 57 instant, MH2 192 planeswalker, WHO 704
 * saga, FRA 358 borderless, MSC 414 extended art, BLB 280 full-art land), a 2003-frame card
 * (TSP 157) and a 1997-frame card (ME4 186). The art box is what the plain frames' art windows
 * share: the 1997 window is the narrowest (0.104 to 0.9 across) and a planeswalker's art stops at
 * its type line (0.495). Borderless, extended-art and full-art cards are all art there, and a
 * saga's art is its right half, so the box takes in its chapter text too: references are cut to
 * the same box, so they match all the same.
 */
const MTG_ART = [0.11, 0.12, 0.89, 0.49] as const satisfies Box

/** The art window's printed border, by frame. */
const MTG_WINDOWS: readonly Box[] = [
  // 2015 (XLN 78, WHO 57) and 2003 (TSP 157).
  [0.075, 0.105, 0.925, 0.553],
  // 2015 planeswalkers (MH2 192): the art stops at the type line.
  [0.075, 0.1, 0.925, 0.497],
  // 1997 (ME4 186).
  [0.104, 0.096, 0.9, 0.54]
]

const MTG_PROFILE: ScanProfile = {
  game: 'mtg',
  artBoxes: [MTG_ART],
  windows: MTG_WINDOWS,
  windowArt: true,
  // A held card's outline is often lost under fingers or a sleeve, while its art window's border
  // or its text box's is found instead.
  innerFrames: [...MTG_WINDOWS, [0.067, 0.6, 0.933, 0.915]],
  windowShape: null,
  codeBands: [
    // 2015 frame's info line, bottom left: "078/279 C" over "XLN • EN" (0.935 to 0.972; foils
    // print ★ for the dot, WHO 704).
    [0.025, 0.925, 0.5, 0.99],
    // Older frames print the collector number in the copyright line: bottom middle on 2003
    // (TSP 157, 0.54 to 0.62 across, 0.96 down), right of middle on 1997 reprints (ME4 186, 0.73
    // to 0.77, 0.925 to 0.94).
    [0.2, 0.915, 0.85, 0.99]
  ],
  codeReach: 0.06,
  // The name, top left, short of the mana cost (0.043 to 0.098 down across the frames).
  nameBand: [0.06, 0.035, 0.7, 0.105],
  // The rules text, read whole to tell the card's language.
  textBox: [0.08, 0.62, 0.92, 0.9],
  rarityLook: false,
  foil: null,
  holderSearch: false,
  keepOutline: true
}

// The Record<'ygo' | 'pkm'> part lists the games every build has a profile for; op's is OP_PROFILE
// and mtg's MTG_PROFILE.
export const SCAN_PROFILES: Record<'ygo' | 'pkm', ScanProfile> &
  Partial<Record<GameId, ScanProfile>> = {
  ygo: {
    game: 'ygo',
    artBoxes: Object.values(ART_BOXES),
    windows: Object.values(ART_BOXES),
    windowArt: false,
    innerFrames: [INNER_FRAME],
    windowShape: null,
    codeBands: CODE_BANDS,
    nameBand: NAME_BAND,
    textBox: TEXT_BOX,
    rarityLook: true,
    foil: null,
    holderSearch: false,
    keepOutline: true
  },
  pkm: {
    game: 'pkm',
    artBoxes: [PKM_ART],
    windows: PKM_WINDOWS,
    windowArt: true,
    // A held card's outline is often lost under fingers, a sleeve or a holder's rim, while its
    // art window's crisp border is found: about a card's shape itself.
    // So is a spread Stadium's card-shaped art panel.
    innerFrames: [...PKM_WINDOWS, ...PKM_SPREAD_PANELS],
    // The windows' short over long side on a 63 x 88 mm card: 0.62 (Scarlet & Violet) to 0.71
    // (base set), about a third of the card's area.
    windowShape: { aspect: 0.66, tolerance: 0.065, minArea: 0.012 },
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
    },
    // Cards are often filmed in toploaders, cases and slabs, small in the frame.
    holderSearch: true,
    keepOutline: true
  },
  op: OP_PROFILE,
  mtg: MTG_PROFILE
}

export function scanProfile(game: GameId): ScanProfile {
  const profile = SCAN_PROFILES[game]
  if (!profile) throw new Error(`No scan profile for ${game}`)
  return profile
}
