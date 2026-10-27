import type { ArtBox, HoloKind, RevealTier } from './types'

/** Lowest to highest. Rip's own order, not the scan's: Platinum Secret sits under Quarter Century. */
export const RIP_TIERS: readonly string[] = [
  'Common',
  'Short Print',
  'Super Short Print',
  'Rare',
  'Super Rare',
  'Starfoil Rare',
  'Shatterfoil Rare',
  'Mosaic Rare',
  'Duel Terminal Parallel Rare',
  'Ultra Parallel Rare',
  'Ultra Rare',
  'Gold Rare',
  'Premium Gold Rare',
  'Secret Rare',
  'Ultimate Rare',
  "Collector's Rare",
  'Ghost Rare',
  'Prismatic Secret Rare',
  'Platinum Secret Rare',
  'Quarter Century Secret Rare',
  'Starlight Rare'
]

/** Rank for a rarity not in RIP_TIERS: just above Common, below Short Print. */
const UNKNOWN_RANK = 0.5

/** A rarity without its trailing variant, e.g. "Ultra Rare" for "Ultra Rare (Pharaoh's Rare)". */
const baseOf = (r: string): string => r.replace(/\s*\(.*\)\s*$/, '')

/** Index of a rarity's base in RIP_TIERS, or -1 when it isn't a known tier. */
const tierIndex = (r: string): number => RIP_TIERS.indexOf(baseOf(r))

/** Higher means rarer. Unknown rarities sit just above Common. */
export function ripRank(rarity: string): number {
  const index = tierIndex(rarity)
  return index === -1 ? UNKNOWN_RANK : index
}

/** Sort comparator, rarest first. */
export function compareRarity(a: string, b: string): number {
  return ripRank(b) - ripRank(a)
}

const RARE_INDEX = RIP_TIERS.indexOf('Rare')
const SECRET_INDEX = RIP_TIERS.indexOf('Secret Rare')

/** How big the pack's reveal is for a card of this rarity. */
export function revealTier(rarity: string): RevealTier {
  const index = tierIndex(rarity)
  if (index < RARE_INDEX) return 'none'
  if (index === RARE_INDEX) return 'rare'
  if (index < SECRET_INDEX) return 'big'
  return 'huge'
}

/**
 * Which holo treatment a card gets. Starlight is always full holo; Secret-family rarities are
 * foil over the art, or over the whole card when the variant is Overframe.
 */
export function holoKind(rarity: string, variant: string | null): HoloKind {
  const base = baseOf(rarity)
  if (base.includes('Starlight')) return 'full'
  if (base.includes('Secret')) {
    return `${rarity} ${variant ?? ''}`.includes('Overframe') ? 'full' : 'art'
  }
  return 'none'
}

const DEFAULT_ART_BOX: ArtBox = { left: 11.9, top: 18.1, right: 11.9, bottom: 29.6 }

/** Pendulum frames have a different layout. Approximate until measured against a cached image. */
const PENDULUM_ART_BOX: ArtBox = { left: 6.6, top: 17.6, right: 6.6, bottom: 25.0 }

/** Where the art sits on a card frame of this type, as percent insets from each edge. */
export function artBox(frameType: string): ArtBox {
  return frameType.includes('pendulum') ? PENDULUM_ART_BOX : DEFAULT_ART_BOX
}
