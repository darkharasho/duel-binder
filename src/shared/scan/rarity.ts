import { surfaceLook, surfaceOver, type SurfaceLook, type SurfaceReading } from './surface'
import {
  NAME_PRISMATIC_MAX_DARK_CONTRAST,
  RARITY_MIN_AGREEMENT,
  RARITY_MIN_READINGS
} from './thresholds'

/** Lowest to highest. Variants like "Ultra Rare (Extended Art)" rank just after their base. */
export const RARITY_TIERS: readonly string[] = [
  'Common',
  'Short Print',
  'Super Short Print',
  'Rare',
  'Super Rare',
  'Ultra Rare',
  'Ultimate Rare',
  'Secret Rare',
  'Ghost Rare',
  'Gold Rare',
  'Prismatic Secret Rare',
  'Starlight Rare',
  'Quarter Century Secret Rare'
]

/** A rarity without its variant, e.g. "Ultra Rare" for "Ultra Rare (Extended Art)". */
const baseOf = (r: string): string => r.replace(/\s*\(.*\)\s*$/, '')

/** A rarity without its variant: "Ultra Rare" for "Ultra Rare (Overframe)". */
export const rarityFamily = baseOf

export function rarityRank(r: string): number {
  const exact = RARITY_TIERS.indexOf(r)
  if (exact !== -1) return exact
  const base = RARITY_TIERS.indexOf(baseOf(r))
  return base !== -1 ? base + 0.5 : RARITY_TIERS.length
}

const lowest = (rarities: string[]): string =>
  [...rarities].sort((a, b) => rarityRank(a) - rarityRank(b))[0] ?? ''

/** The rarity to add for a printing; `certain` is false when we had to guess. */
export function pickRarity(
  available: string[],
  preferred: string | null
): { rarity: string; certain: boolean } {
  const distinct = [...new Set(available)]
  if (distinct.length === 1) return { rarity: distinct[0], certain: true }
  if (preferred !== null && distinct.includes(preferred))
    return { rarity: preferred, certain: true }
  // A printing labelled with its variant ("Ultra Rare (New artwork)") when it is the only one.
  const ofBase = distinct.filter((r) => preferred !== null && baseOf(r) === preferred)
  if (ofBase.length === 1) return { rarity: ofBase[0], certain: true }
  return { rarity: lowest(distinct), certain: false }
}

/** How a card's name reads on camera: its ink darker or lighter than the bar around it. */
export type NameInk = 'dark' | 'light'

/**
 * The colour of a name's ink against its bar: gold (yellow, unlike the bar) or silver (light,
 * far less saturated than the bar, or spread over many hues). Null when it is neither.
 */
export type NameTint = 'gold' | 'silver'

/** What one frame shows of a card's foil. */
export interface RarityCues {
  /** Null when the name couldn't be read. */
  nameInk: NameInk | null
  nameTint: NameTint | null
  /**
   * How much darker the name's ink is than the bar around it, in luma from 0 to 1 (negative when
   * lighter); null or undefined when the name couldn't be read.
   */
  nameContrast?: number | null
  /** The texture of the frame beside the artwork and of the effect text; null when unmeasured. */
  surface?: SurfaceReading | null
}

type NameLook = 'plain' | 'gold' | 'smooth gold' | 'prismatic'

/**
 * How a rarity's name is printed. Plain ink is black or white by frame. A gold foil name (Ultra,
 * Premium Gold) mirrors the room and mostly reads dark on camera, but glare can make it read
 * light; a prismatic one (Secret, Starlight and kin) scatters light and reads light and silver.
 * An Ultra's smooth gold, unlike Premium Gold's glittery one, never read light and silver on a
 * dark-name frame in about 250 photos and scans, where prismatic names mostly do. Rarities
 * missing here, such as Rare, Ultimate, Ghost, Collector's and the parallel foils, have no known
 * look, so they are never ruled out.
 */
const NAME_LOOKS: Record<string, NameLook> = {
  Common: 'plain',
  'Short Print': 'plain',
  'Super Short Print': 'plain',
  'Super Rare': 'plain',
  'Ultra Rare': 'smooth gold',
  'Premium Gold Rare': 'gold',
  'Secret Rare': 'prismatic',
  'Prismatic Secret Rare': 'prismatic',
  'Platinum Secret Rare': 'prismatic',
  'Quarter Century Secret Rare': 'prismatic',
  'Starlight Rare': 'prismatic'
}

/** Frames whose plain names are printed white; the rest (but Skill) print them black. */
const WHITE_NAME_FRAMES = new Set(['spell', 'trap', 'xyz', 'xyz_pendulum', 'link'])
const BLACK_NAME_FRAMES = new Set([
  'normal',
  'effect',
  'ritual',
  'fusion',
  'synchro',
  'token',
  'normal_pendulum',
  'effect_pendulum',
  'ritual_pendulum',
  'fusion_pendulum',
  'synchro_pendulum'
])

function plainInk(frameType: string): NameInk | null {
  if (WHITE_NAME_FRAMES.has(frameType)) return 'light'
  if (BLACK_NAME_FRAMES.has(frameType)) return 'dark'
  return null
}

/** Whether a look fits a rarity, rules it out, or can't tell. */
export type Fit = 'fits' | 'out' | 'maybe'

/**
 * Frames whose name bar is pale (white, grey or yellow): a prismatic name on them reads darker
 * than the bar about half the time on camera (10 of 18 Synchro cards in the eBay and webcam
 * shots), so a dark name there doesn't rule prismatic out.
 */
const PALE_BARS = new Set(['synchro', 'synchro_pendulum', 'token', 'normal', 'normal_pendulum'])

/** Frames whose plain names are white on every print, old or new: a dark name there is foil. */
const ALWAYS_WHITE_NAME_FRAMES = new Set(['xyz', 'xyz_pendulum', 'link'])

/**
 * Whether a name that reads `cues` fits a rarity of `look`, rules it out, or can't tell, on a
 * frame whose plain names read `plain`. Each call needs the ink's colour to agree with its
 * polarity: gold fits only dark gold ink, prismatic only light silver ink. Plain ink is ruled
 * out only by ink that is plainly foil. Gold is ruled out only when smooth (Ultra) and the name
 * reads light and silver where plain names are black, since glare can turn gold light and on
 * camera it mostly takes the bar's colour. On Xyz and Link frames, whose plain names are white on
 * every print, a dark name can only be foil mirroring the room: gold fits it and plain is ruled
 * out. A dark name rules prismatic out when it reads gold, or elsewhere than on a pale bar when
 * it is far darker than the bar (NAME_PRISMATIC_MAX_DARK_CONTRAST): a prismatic name that reads
 * dark, as about 1 in 12 do on orange and other dark-name frames, is never that much darker.
 */
function fit(look: NameLook, cues: RarityCues, plain: NameInk, frameType: string): Fit {
  const { nameInk: ink, nameTint: tint } = cues
  const darkOnWhite = ink === 'dark' && ALWAYS_WHITE_NAME_FRAMES.has(frameType)
  const gold = ink === 'dark' && tint === 'gold'
  const prismatic = ink === 'light' && tint === 'silver'
  if (look === 'smooth gold' && prismatic && plain === 'dark') return 'out'
  if (look === 'gold' || look === 'smooth gold') return gold || darkOnWhite ? 'fits' : 'maybe'
  if (look === 'prismatic')
    return prismatic
      ? 'fits'
      : ink === 'dark' &&
          (gold ||
            (!PALE_BARS.has(frameType) &&
              (cues.nameContrast ?? 0) >= NAME_PRISMATIC_MAX_DARK_CONTRAST))
        ? 'out'
        : 'maybe'
  if (darkOnWhite) return 'out'
  if (ink === plain) return 'fits'
  return gold || prismatic ? 'out' : 'maybe'
}

/**
 * How a rarity's frame beside the artwork reads: foil for the rarities that are foil all over
 * (Starlight, Quarter Century Secret), plain card stock for those whose foil stays on the name
 * and artwork. Rarities missing here, such as Platinum Secret (whose frame is textured too),
 * Collector's, Ultimate and Gold, are never ruled out by it; nor are variants such as Overframe.
 */
const SURFACE_LOOKS: Record<string, SurfaceLook> = {
  Common: 'plain',
  'Short Print': 'plain',
  'Super Short Print': 'plain',
  Rare: 'plain',
  'Super Rare': 'plain',
  'Ultra Rare': 'plain',
  'Secret Rare': 'plain',
  'Prismatic Secret Rare': 'plain',
  'Ghost Rare': 'plain',
  'Starlight Rare': 'foil',
  'Quarter Century Secret Rare': 'foil'
}

/** Artwork run over the frame reads as a foil frame, so with such an option the frame isn't read. */
const OVER_FRAME = /overframe|full art/i

/**
 * How each distinct rarity in `available` fits the look seen on a card with frameType. Its name
 * and its frame beside the artwork are each checked, and either can rule a rarity out: 'out'
 * when either does, else 'fits' when either fits it, else 'maybe'.
 */
export function rarityFits(
  available: string[],
  cues: RarityCues,
  frameType: string
): { rarity: string; fit: Fit }[] {
  const distinct = [...new Set(available)]
  const plain = plainInk(frameType)
  // A frame is read only on a shot whose name was read too: one too blurred or glared for that
  // can hide a Starlight's glitter.
  const frame =
    !cues.nameInk || distinct.some((r) => OVER_FRAME.test(r))
      ? null
      : surfaceLook(cues.surface ?? null, frameType)
  return distinct.map((r) => {
    const nameLook = NAME_LOOKS[baseOf(r)]
    const surface = r === baseOf(r) ? SURFACE_LOOKS[r] : undefined
    const fits: Fit[] = [
      cues.nameInk && plain && nameLook ? fit(nameLook, cues, plain, frameType) : 'maybe',
      frame && surface ? (frame === surface ? 'fits' : 'out') : 'maybe'
    ]
    const verdict: Fit = fits.includes('out') ? 'out' : fits.includes('fits') ? 'fits' : 'maybe'
    return { rarity: r, fit: verdict }
  })
}

/**
 * The rarity among `available` whose look fits the one seen, on a card with frameType (see
 * rarityFits). It is certain only when it fits and every other rarity is ruled out: rarities that
 * look alike (Common and Super Rare, a rarity and its variants) are never told apart. Otherwise
 * it is the lowest tier, uncertain.
 */
export function pickRarityByCues(
  available: string[],
  cues: RarityCues,
  frameType: string
): { rarity: string; certain: boolean } {
  const distinct = [...new Set(available)]
  if (distinct.length === 1) return { rarity: distinct[0], certain: true }
  const fits = rarityFits(distinct, cues, frameType)
  const chosen = fits.findIndex((f) => f.fit === 'fits')
  if (chosen !== -1 && fits.every((f, i) => i === chosen || f.fit === 'out'))
    return { rarity: distinct[chosen], certain: true }
  return { rarity: lowest(distinct), certain: false }
}

/** The value at least RARITY_MIN_AGREEMENT of `values` share, if any. */
function agreed<T>(values: T[]): T | null {
  for (const v of new Set(values))
    if (values.filter((x) => x === v).length >= RARITY_MIN_AGREEMENT * values.length) return v
  return null
}

/**
 * The cues over the frames of one showing: the ink at least RARITY_MIN_AGREEMENT of the
 * readings show, once there are RARITY_MIN_READINGS of them, and the tint as many of those
 * agree on, with the median contrast of those that show it; and the median surface of the frames
 * that measured one, once there are RARITY_MIN_READINGS of those. Unread frames don't count.
 */
export function cuesOver(readings: RarityCues[]): RarityCues {
  const surfaces = readings.flatMap((r) => (r.surface ? [r.surface] : []))
  const surface = surfaces.length < RARITY_MIN_READINGS ? null : surfaceOver(surfaces)
  const read = readings.filter((r) => r.nameInk !== null)
  const ink = read.length < RARITY_MIN_READINGS ? null : agreed(read.map((r) => r.nameInk))
  if (!ink) return { nameInk: null, nameTint: null, surface }
  const agreeing = read.filter((r) => r.nameInk === ink)
  const contrasts = agreeing.flatMap((r) =>
    typeof r.nameContrast === 'number' ? [r.nameContrast] : []
  )
  return {
    nameInk: ink,
    nameTint: agreed(agreeing.map((r) => r.nameTint)),
    nameContrast: contrasts.length ? median(contrasts) : null,
    surface
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
