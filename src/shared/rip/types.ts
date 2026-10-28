/** How big a pack's reveal is for one card: none, a plain flip, a big flourish, or the full show. */
export type RevealTier = 'none' | 'rare' | 'big' | 'huge'

/** Which holo treatment a card gets: none, foil over the art only, or foil over the whole card. */
/** 'soft' is the gentler sheen over the art of the non-Secret foils. */
export type HoloKind = 'none' | 'soft' | 'art' | 'full'

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
  /** Only cards numbered in this range (the digits ending the code, RA03-EN123 → 123), inclusive. */
  numbers?: { from: number; to?: number }
}

/** A researched pack layout. Slots are listed low to high, so the rarest slot comes last. */
export interface PackLayout {
  id: string
  label: string
  slots: PackSlot[]
  /** Where the slot counts and odds came from. */
  source: string
  /**
   * How big a reveal a rarity gets in this product, where it differs from the usual (in an all-foil
   * set a Super Rare is the floor, not a hit). By base rarity.
   */
  tiers?: Partial<Record<string, RevealTier>>
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

/** A pack photo with more than one wrapper side by side: its size, and each wrapper's box in it. */
export interface PackWrappers {
  width: number
  height: number
  wrappers: { x: number; y: number; width: number; height: number }[]
}

/** A set Rip can open:English, with a researched layout and a pool that fills every slot. */
export interface RipSet {
  setName: string
  setCode: string
  tcgDate: string | null
  imageKey: string | null
  packImageKey: string | null
  logoImageKey: string | null
  coverImageId: number | null
  /** Era name, e.g. "Core Booster (2010–2015)"; shown as a tooltip. */
  layoutLabel: string
  /** What's in a pack, e.g. "9 cards a pack · 1 Rare + 1 Super or better". */
  packLine: string
}

/** One rip session: a set opened for `packCount` packs, of which `packsOpened` have been saved. */
export interface RipSessionSummary {
  id: number
  setName: string
  setCode: string
  packCount: number
  packsOpened: number
  startedAt: string
  /** The session's rarest pull, or null before any pack is opened. */
  best: RipCard | null
}

export interface RipSessionDetail extends RipSessionSummary {
  /** Opened packs in order; each is its cards by slot. */
  packs: RipCard[][]
}

export interface RipHistory {
  packsOpened: number
  cardsPulled: number
  setsRipped: number
  bestPulls: RipCard[]
  sessions: RipSessionSummary[]
}
