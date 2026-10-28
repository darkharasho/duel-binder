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
  'Gold Secret Rare',
  'Ultimate Rare',
  "Collector's Rare",
  'Ghost Rare',
  'Ghost/Gold Rare',
  'Prismatic Secret Rare',
  'Platinum Secret Rare',
  'Quarter Century Secret Rare',
  'Starlight Rare',
  '10000 Secret Rare'
]

/** Rank for a rarity not in RIP_TIERS: just above Common, below Short Print. */
const UNKNOWN_RANK = 0.5

/** A rarity without its trailing variant, e.g. "Ultra Rare" for "Ultra Rare (Pharaoh's Rare)". */
export const baseOf = (r: string): string => r.replace(/\s*\(.*\)\s*$/, '')

/**
 * A rarity with its base spelled as in RIP_TIERS, whatever the source's capitalisation
 * ("PLatinum Secret Rare" → "Platinum Secret Rare"). Unknown rarities come back unchanged.
 */
export function canonicalRarity(r: string): string {
  const base = baseOf(r)
  const known = RIP_TIERS.find((t) => t.toLowerCase() === base.toLowerCase())
  return known ? known + r.slice(base.length) : r
}

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
 * foil over the art, or over the whole card when the variant is Overframe. Other foils (Super,
 * Ultra, Ghost and the like) get a softer sheen over the art; a plain Rare gets none.
 */
export function holoKind(rarity: string, variant: string | null): HoloKind {
  const base = baseOf(rarity)
  if (base.includes('Starlight')) return 'full'
  if (base.includes('Secret')) {
    return `${rarity} ${variant ?? ''}`.includes('Overframe') ? 'full' : 'art'
  }
  const tier = revealTier(rarity)
  return tier === 'big' || tier === 'huge' ? 'soft' : 'none'
}

const DEFAULT_ART_BOX: ArtBox = { left: 11.9, top: 18.1, right: 11.9, bottom: 29.6 }

/** Measured on a cached 813×1185 Pendulum image; the art stops at the top of the Pendulum effect box. */
const PENDULUM_ART_BOX: ArtBox = { left: 6.4, top: 17.9, right: 6.4, bottom: 38.0 }

/** Where the art sits on a card frame of this type, as percent insets from each edge. */
export function artBox(frameType: string): ArtBox {
  return frameType.includes('pendulum') ? PENDULUM_ART_BOX : DEFAULT_ART_BOX
}

/** The name strip, measured on the same 813×1185 image; it stops short of the attribute icon. */
const NAME_BOX: ArtBox = { left: 5.7, top: 4.1, right: 17.8, bottom: 88.9 }

/** Where the card's name sits, as percent insets from each edge. The same on every frame. */
export function nameBox(): ArtBox {
  return NAME_BOX
}

/** Whether the name is printed in white (Xyz, Link, Spell and Trap frames) or in black. */
export function nameInk(frameType: string): 'light' | 'dark' {
  return /xyz|link|spell|trap/.test(frameType) ? 'light' : 'dark'
}

/** Starlight gets a glittery, radiating foil over the whole card instead of the Secret crosshatch. */
export function isStarlight(rarity: string): boolean {
  return baseOf(rarity).includes('Starlight')
}
