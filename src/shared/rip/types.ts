/** How big a pack's reveal is for one card: none, a plain flip, a big flourish, or the full show. */
export type RevealTier = 'none' | 'rare' | 'big' | 'huge'

/** Which holo treatment a card gets: none, foil over the art only, or foil over the whole card. */
export type HoloKind = 'none' | 'art' | 'full'

/** Percent insets from each edge of a card frame, marking where the art sits. */
export interface ArtBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** One rarity a pack slot can hold, with its relative weight within the slot. */
export interface SlotPick {
  rarity: string
  weight: number
}

/** `picks[0]` is the base rarity: it must exist in the set and absorbs missing rarities' weight. */
export interface PackSlot {
  count: number
  picks: SlotPick[]
}

/** A researched pack layout. Slots are listed low to high, so the rarest slot comes last. */
export interface PackLayout {
  id: string
  label: string
  slots: PackSlot[]
  /** Where the slot counts and odds came from. */
  source: string
}

/** One printing a pack can hold. No prices, by design. */
export interface PoolCard {
  pkey: string
  cardId: number
  name: string
  setCode: string
  rarity: string
  variant: string | null
  frameType: string
  imageId: number | null
}

/** A card pulled from a pack; `slot` is its index in the pack. */
export interface RipCard extends PoolCard {
  slot: number
}
