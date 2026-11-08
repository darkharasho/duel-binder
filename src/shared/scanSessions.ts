import type { GameId } from './games'

/** The most cards one scan session holds. */
export const MAX_SESSION_CARDS = 1000
/** The longest printing key a session card may carry. */
export const MAX_SESSION_PKEY = 300

/**
 * One card added in a session, with the price it had when it was added. Printing ids differ
 * between each app and the server, so `pkey` names the printing everywhere; `printingId` and
 * `photoId` are filled from it by whoever reads the session, against their own catalog.
 */
export interface ScanSessionCard {
  cardId: number
  /** The printing's sync key (card_printings.pkey): the card's identity on every device. */
  pkey: string
  /** The reader's id for the printing; null when its catalog lacks the pkey. */
  printingId: number | null
  imageId: number
  /** The reader's printing id when the card showed the printing's own photo, else null (card art). */
  photoId: number | null
  name: string
  setCode: string | null
  rarity: string | null
  quantity: number
  /** Unit price at Add time; null until a later fill (set once, never changed). */
  price: number | null
  /** The scanner guessed this printing rather than reading it. */
  guess: boolean
  /** Epoch milliseconds when the card was added. */
  addedAt: number
}

/** A card as the scanner records it: its printing id on this device, before the pkey is looked up. */
export type ScanSessionCardDraft = Omit<ScanSessionCard, 'pkey' | 'printingId'> & {
  printingId: number
}

/** What a list returns: the cards added in one scanner "Add to collection". */
export interface ScanSession {
  uid: string
  game: GameId
  cards: ScanSessionCard[]
  friendsVisible: boolean
  createdAt: string
  updatedAt: string
}

export interface WireScanSession extends ScanSession {
  deletedAt: string | null
}

export type ScanSessionPushResult =
  | { uid: string; status: 'applied' | 'skipped' }
  | { uid: string; status: 'stale'; current: WireScanSession }

export interface ScanSessionPullResponse {
  sessions: WireScanSession[]
  cursor: number
  more: boolean
}

/** Value of the priced cards (price x quantity) and how many cards are priced or not. */
export function sessionTotal(cards: ScanSessionCard[]): {
  value: number
  priced: number
  unpriced: number
} {
  let value = 0
  let priced = 0
  let unpriced = 0
  for (const c of cards) {
    if (c.price === null) unpriced++
    else {
      priced++
      value += c.price * c.quantity
    }
  }
  return { value, priced, unpriced }
}
