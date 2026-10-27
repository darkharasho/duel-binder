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
