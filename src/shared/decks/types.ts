import type { GameId } from '../games'

/** Where a deck entry sits; later games widen this union. */
export type DeckSection = 'main' | 'extra' | 'side'

export interface DeckEntry {
  section: DeckSection
  /** The catalog's cards.id, the same on every device. */
  card: number
  /** A pinned printing (a pkey); absent = any printing. */
  printing?: string
  qty: number
}

/** The fields a user edits on a deck, as stored and synced. */
export interface DeckFields {
  format: string
  name: string
  notes: string
  cover: number | null
  private: boolean
  cards: DeckEntry[]
}

/** A new deck (no uid) or an edit of one. */
export interface DeckDraft extends DeckFields {
  uid?: string
}

/** What the checks and the screens need of one card; absent from the map = not in this catalog. */
export interface DeckCard {
  id: number
  name: string
  type: string
  frameType: string
  imageId: number | null
  owned: number
  price: number | null
  regionPrice: number | null
}

export type VerdictStatus = 'legal' | 'warnings' | 'illegal' | 'unknown' | 'update'

export interface DeckVerdictMark {
  status: VerdictStatus
  problems: string[]
  packVersion: string
}

export interface DeckSummary {
  uid: string
  game: GameId
  format: string
  name: string
  private: boolean
  coverImageId: number | null
  cards: DeckEntry[]
  createdAt: string
  updatedAt: string
  lastSeen: DeckVerdictMark | null
}

export interface DeckList {
  decks: DeckSummary[]
  cardFacts: Record<number, DeckCard>
}

export interface DeckDetail extends DeckSummary {
  notes: string
  cover: number | null
  cardFacts: Record<number, DeckCard>
  printingArt: Record<string, number>
}

export interface WireDeck {
  uid: string
  game: GameId
  format: string
  name: string
  notes: string
  cover: number | null
  private: boolean
  cards: DeckEntry[]
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
