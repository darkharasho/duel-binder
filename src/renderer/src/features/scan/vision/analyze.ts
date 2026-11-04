// One camera frame's vision work: finding the card, matching its art against the fingerprints
// and cutting out its text bands for OCR. Pure apart from OpenCV, so tests run the worker's path.
import type { FingerprintIndex } from '@shared/scan/fingerprintFile'
import { ART_MATCH_DEPTH } from '@shared/scan/thresholds'
import type { Mat } from '@techstark/opencv-js'
import { SCAN_PROFILES, type Box, type ScanProfile } from '@shared/scan/profiles'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import type { ArtMatch, FrameSignals } from '../engine'
import { toBand, toBlock, toGrayBand, toInkBlock } from './bands'
import { findCandidates, preferOuter, recognizeArt } from './candidates'
import type { CV } from './cv'
import {
  CARD_W,
  dist,
  rotate180,
  toMat,
  using,
  warpCard,
  type FrameSource,
  type Quad
} from './detect'
import { isSlab } from './holder'
import { pokemonVersionCues } from './pokemonVersion'
import { rarityLook } from './rarityCues'

/** How far past CARD_W a card is straightened for reading its text. */
const MAX_BAND_SCALE = 2

const NOTHING: FrameSignals = {
  found: false,
  quad: null,
  art: [],
  codeBands: [],
  nameBands: [],
  textBands: [],
  cues: null,
  version: null,
  look: null
}

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0

/**
 * A frame's signals in the worker, with the card turned upright at CARD_W when asked for and
 * known. upright stays in the worker: it's dropped before the signals are posted.
 */
export type AnalyzedFrame = FrameSignals & { upright?: RgbaImage }

/**
 * The width to straighten a card to for reading its text: its width in the frame, so a card
 * filmed bigger than CARD_W keeps its detail (a 4K camera's set code is twice a 1080p one's),
 * within CARD_W to MAX_BAND_SCALE times that.
 */
export function bandWidth(quad: Quad): number {
  const shown = (dist(quad[0], quad[1]) + dist(quad[2], quad[3])) / 2
  return Math.round(Math.min(MAX_BAND_SCALE * CARD_W, Math.max(CARD_W, shown)))
}

/**
 * A profile's code bands off the card in quad: `ways` is the straightened card (at bandWidth) as
 * analyze reads it, upright or both ways up. Each band as it is (codeGray) or cut down to its line
 * of ink. With codeReach they're cut instead from the card warped with that margin around it
 * (turned as `upsideDown` says, or both ways when that's unknown), each box mapped into it, so a
 * band past the outline holds what's printed there. Without it, this is exactly the bands off
 * `ways`, as before codeReach.
 */
export function cutCodeBands(
  cv: CV,
  img: FrameSource,
  quad: Quad,
  profile: ScanProfile,
  ways: RgbaImage[],
  upsideDown: boolean | null
): OcrBand[] {
  const cut = profile.codeGray ? toGrayBand : toBand
  const reach = profile.codeReach ?? 0
  if (reach <= 0)
    return ways.flatMap((c) => profile.codeBands.map((box) => cut(c, box))).filter(hasPixels)
  const around = warpCard(cv, img, quad, bandWidth(quad), reach)
  const cards =
    upsideDown === null ? [around, rotate180(around)] : [upsideDown ? rotate180(around) : around]
  const inAround = (box: Box): Box =>
    box.map((v) => (v + reach) / (1 + 2 * reach)) as unknown as Box
  return cards
    .flatMap((c) => profile.codeBands.map((box) => cut(c, inAround(box))))
    .filter(hasPixels)
}

/**
 * The frame's signals, matched against index (null: no art matching), with the look model's
 * features when wantLook, read off the regions of profile's game (whose rarity cues and look are
 * left null when it has none). It's copied into OpenCV once, for finding the card and every warp
 * of it, and freed whatever happens. holderPass false skips the holder search of a profile that
 * has one, for a frame the caller has already given its share of them (holderBudget.ts). held is
 * an earlier frame's outline, tried before the frame is searched (recognizeArt). thorough false
 * is a live frame's short holder search (recognizeArt). wantUpright adds the upright card, for
 * keeping a frame for a rarity read; it is still a whole live frame, with the same rarity cues,
 * look, version cues and slab as without it.
 */
export function analyze(
  cv: CV,
  img: RgbaImage,
  index: FingerprintIndex | null,
  candidates: number[] | null,
  wantBands: boolean,
  wantLook = false,
  profile: ScanProfile = SCAN_PROFILES.ygo,
  holderPass = true,
  held: Quad | null = null,
  thorough = true,
  wantUpright = false
): AnalyzedFrame {
  const frame = toMat(cv, img)
  return using([frame], () =>
    analyzeFrame(
      cv,
      frame,
      index,
      candidates,
      wantBands,
      wantLook,
      profile,
      holderPass,
      held,
      thorough,
      wantUpright
    )
  )
}

function analyzeFrame(
  cv: CV,
  img: Mat,
  index: FingerprintIndex | null,
  candidates: number[] | null,
  wantBands: boolean,
  wantLook: boolean,
  profile: ScanProfile,
  holderPass: boolean,
  held: Quad | null,
  thorough: boolean,
  wantUpright: boolean
): AnalyzedFrame {
  let quad: Quad
  let art: ArtMatch[] = []
  // The straightened card for its text, made only when bands are wanted.
  let card: () => RgbaImage
  // The card turned upright at CARD_W, when art matching found which way up it is.
  let upright: RgbaImage | null = null
  // Set only when the art matched on the holder search's second look.
  let via: { artVia?: 'holder' } = {}
  // Which way up the card is, when art matching found it (null: unknown, read both ways).
  let upsideDown: boolean | null = null
  if (index) {
    const found = recognizeArt(
      cv,
      img,
      index,
      candidates ? new Set(candidates) : undefined,
      ART_MATCH_DEPTH,
      profile,
      holderPass,
      held,
      thorough
    )
    if (!found) return NOTHING
    quad = found.quad
    art = found.matches
    if (found.via) via = { artVia: found.via }
    upright = found.upsideDown === null ? null : found.card
    upsideDown = found.upsideDown
    // Art is matched at CARD_W, the size it was tuned for; text is read at the card's own size.
    card = () => {
      const width = bandWidth(found.quad)
      if (width === CARD_W) return found.card
      const big = warpCard(cv, img, found.quad, width)
      return found.upsideDown ? rotate180(big) : big
    }
  } else {
    // No fingerprints: the candidate finder's likeliest outline (it holds up on real photos far
    // better than findCard alone), or the card around it when that is one of its inner frames.
    // Not turned upright, so its foil isn't looked at and its text is read both ways.
    const likeliest = preferOuter(findCandidates(cv, img, profile))
    if (!likeliest) return NOTHING
    quad = likeliest
    card = () => warpCard(cv, img, likeliest, bandWidth(likeliest))
  }
  // Read at CARD_W, the size the cues and the look model were tuned at; Yu-Gi-Oh's foils only.
  const { cues, features: look } =
    upright && profile.rarityLook ? rarityLook(upright, wantLook) : { cues: null, features: null }
  // Pokémon only: its versions are priced apart, and a graded slab changes how it's priced.
  // Yu-Gi-Oh's signals carry no slab key.
  const pokemon = profile.game === 'pkm'
  const version = pokemon && upright ? pokemonVersionCues(upright, profile) : null
  const slab = pokemon ? isSlab(cv, img, quad) : undefined
  const kept = wantUpright && upright ? { upright } : {}
  if (!wantBands)
    return {
      found: true,
      quad,
      art,
      codeBands: [],
      nameBands: [],
      textBands: [],
      cues,
      version,
      ...(slab === undefined ? {} : { slab }),
      ...via,
      look,
      ...kept
    }
  const straight = card()
  // Not knowing which way up the card is, its text is read both ways.
  const ways = upright ? [straight] : [straight, rotate180(straight)]
  return {
    found: true,
    quad,
    art,
    codeBands: cutCodeBands(cv, img, quad, profile, ways, upsideDown),
    nameBands: ways.map((c) => toBand(c, profile.nameBand)).filter(hasPixels),
    // Only a card whose art matched: read off a guessed outline, it reads as a language too often.
    // A Pokémon card's is cut out twice, as it is and as ink on white (each read on its own): a
    // webcam's small text on a mottled box often reads only one way.
    textBands: upright
      ? [
          toBlock(straight, profile.textBox),
          ...(pokemon ? [toInkBlock(straight, profile.textBox)] : [])
        ].filter(hasPixels)
      : [],
    cues,
    version,
    ...(slab === undefined ? {} : { slab }),
    ...via,
    look,
    ...kept
  }
}
