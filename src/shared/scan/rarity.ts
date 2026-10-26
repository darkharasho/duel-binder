import { RARITY_MIN_AGREEMENT, RARITY_MIN_READINGS } from './thresholds'

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
}

/**
 * How a rarity's name is printed. Plain ink is black or white by frame. A gold foil name (Ultra,
 * Premium Gold) mirrors the room and mostly reads dark on camera, but glare can make it read
 * light; a prismatic one (Secret, Starlight and kin) scatters light and reads light and silver.
 * Rarities missing here, such as Rare, Ultimate, Ghost, Collector's and the parallel foils, have
 * no known look, so they are never ruled out.
 */
const NAME_LOOKS: Record<string, 'plain' | 'gold' | 'prismatic'> = {
  Common: 'plain',
  'Short Print': 'plain',
  'Super Short Print': 'plain',
  'Super Rare': 'plain',
  'Ultra Rare': 'gold',
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

type Fit = 'fits' | 'out' | 'maybe'

/**
 * Whether a name that reads `cues` fits a rarity of `look`, rules it out, or can't tell, on a
 * frame whose plain names read `plain`. Each call needs the ink's colour to agree with its
 * polarity: gold fits only dark gold ink, prismatic only light silver ink. Plain ink is ruled
 * out only by ink that is plainly foil. Gold is never ruled out, since glare can turn it light
 * and on camera it mostly takes the bar's colour.
 */
function fit(look: 'plain' | 'gold' | 'prismatic', cues: RarityCues, plain: NameInk): Fit {
  const { nameInk: ink, nameTint: tint } = cues
  const gold = ink === 'dark' && tint === 'gold'
  const prismatic = ink === 'light' && tint === 'silver'
  if (look === 'gold') return gold ? 'fits' : 'maybe'
  if (look === 'prismatic') return prismatic ? 'fits' : ink === 'dark' ? 'out' : 'maybe'
  if (ink === plain) return 'fits'
  return gold || prismatic ? 'out' : 'maybe'
}

/**
 * The rarity among `available` whose name looks like the one seen, on a card with frameType.
 * It is certain only when it fits and every other rarity is ruled out: rarities that look alike
 * (Common and Super Rare, Secret and Starlight, a rarity and its variants) are never told apart.
 * Otherwise it is the lowest tier, uncertain.
 */
export function pickRarityByCues(
  available: string[],
  cues: RarityCues,
  frameType: string
): { rarity: string; certain: boolean } {
  const distinct = [...new Set(available)]
  if (distinct.length === 1) return { rarity: distinct[0], certain: true }
  const plain = plainInk(frameType)
  const looks = distinct.map((r) => NAME_LOOKS[baseOf(r)])
  if (cues.nameInk && plain && looks.every(Boolean)) {
    const fits = looks.map((look) => fit(look, cues, plain))
    const chosen = fits.indexOf('fits')
    if (chosen !== -1 && fits.every((f, i) => i === chosen || f === 'out'))
      return { rarity: distinct[chosen], certain: true }
  }
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
 * agree on. Unread frames don't count.
 */
export function cuesOver(readings: RarityCues[]): RarityCues {
  const read = readings.filter((r) => r.nameInk !== null)
  const ink = read.length < RARITY_MIN_READINGS ? null : agreed(read.map((r) => r.nameInk))
  if (!ink) return { nameInk: null, nameTint: null }
  return {
    nameInk: ink,
    nameTint: agreed(read.filter((r) => r.nameInk === ink).map((r) => r.nameTint))
  }
}
