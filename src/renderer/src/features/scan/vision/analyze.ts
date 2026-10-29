// One camera frame's vision work: finding the card, matching its art against the fingerprints
// and cutting out its text bands for OCR. Pure apart from OpenCV, so tests run the worker's path.
import type { FingerprintIndex } from '@shared/scan/fingerprintFile'
import { ART_MATCH_DEPTH } from '@shared/scan/thresholds'
import type { Mat } from '@techstark/opencv-js'
import { SCAN_PROFILES, type ScanProfile } from '@shared/scan/profiles'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import type { ArtMatch, FrameSignals } from '../engine'
import { toBand, toBlock } from './bands'
import { findCandidates, preferOuter, recognizeArt } from './candidates'
import type { CV } from './cv'
import { CARD_W, dist, rotate180, toMat, using, warpCard, type Quad } from './detect'
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
 * The width to straighten a card to for reading its text: its width in the frame, so a card
 * filmed bigger than CARD_W keeps its detail (a 4K camera's set code is twice a 1080p one's),
 * within CARD_W to MAX_BAND_SCALE times that.
 */
function bandWidth(quad: Quad): number {
  const shown = (dist(quad[0], quad[1]) + dist(quad[2], quad[3])) / 2
  return Math.round(Math.min(MAX_BAND_SCALE * CARD_W, Math.max(CARD_W, shown)))
}

/**
 * The frame's signals, matched against index (null: no art matching), with the look model's
 * features when wantLook, read off the regions of profile's game (whose rarity cues and look are
 * left null when it has none). It's copied into OpenCV once, for finding the card and every warp
 * of it, and freed whatever happens.
 */
export function analyze(
  cv: CV,
  img: RgbaImage,
  index: FingerprintIndex | null,
  candidates: number[] | null,
  wantBands: boolean,
  wantLook = false,
  profile: ScanProfile = SCAN_PROFILES.ygo
): FrameSignals {
  const frame = toMat(cv, img)
  return using([frame], () =>
    analyzeFrame(cv, frame, index, candidates, wantBands, wantLook, profile)
  )
}

function analyzeFrame(
  cv: CV,
  img: Mat,
  index: FingerprintIndex | null,
  candidates: number[] | null,
  wantBands: boolean,
  wantLook: boolean,
  profile: ScanProfile
): FrameSignals {
  let quad: Quad
  let art: ArtMatch[] = []
  // The straightened card for its text, made only when bands are wanted.
  let card: () => RgbaImage
  // The card turned upright at CARD_W, when art matching found which way up it is.
  let upright: RgbaImage | null = null
  if (index) {
    const found = recognizeArt(
      cv,
      img,
      index,
      candidates ? new Set(candidates) : undefined,
      ART_MATCH_DEPTH,
      profile
    )
    if (!found) return NOTHING
    quad = found.quad
    art = found.matches
    upright = found.upsideDown === null ? null : found.card
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
    const likeliest = preferOuter(findCandidates(cv, img))
    if (!likeliest) return NOTHING
    quad = likeliest
    card = () => warpCard(cv, img, likeliest, bandWidth(likeliest))
  }
  // Read at CARD_W, the size the cues and the look model were tuned at; Yu-Gi-Oh's foils only.
  const { cues, features: look } =
    upright && profile.rarityLook ? rarityLook(upright, wantLook) : { cues: null, features: null }
  const version = upright ? pokemonVersionCues(upright, profile) : null
  // Pokémon only (a graded slab changes how it's priced); Yu-Gi-Oh's signals carry no slab key.
  const slab = profile.foil ? isSlab(cv, img, quad) : undefined
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
      look
    }
  const straight = card()
  // Not knowing which way up the card is, its text is read both ways.
  const ways = upright ? [straight] : [straight, rotate180(straight)]
  return {
    found: true,
    quad,
    art,
    codeBands: ways
      .flatMap((c) => profile.codeBands.map((box) => toBand(c, box)))
      .filter(hasPixels),
    nameBands: ways.map((c) => toBand(c, profile.nameBand)).filter(hasPixels),
    // Only a card whose art matched: read off a guessed outline, it reads as a language too often.
    textBands: upright ? [toBlock(straight, profile.textBox)].filter(hasPixels) : [],
    cues,
    version,
    ...(slab === undefined ? {} : { slab }),
    look
  }
}
