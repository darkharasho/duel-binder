import type { GameId } from '../games'
import type { DeckCard, DeckSection } from './types'
import { isExtraFrame } from './ygo/check'

export interface SectionDef {
  id: DeckSection
  label: string
  min: number
  max: number
}

export interface DeckFormat {
  id: string
  label: string
  sections: SectionDef[]
  /** Which region's printings a card must be out in, and which price column applies. */
  priceRegion: 'en' | 'asia'
}

const YGO_SECTIONS: SectionDef[] = [
  { id: 'main', label: 'Main Deck', min: 40, max: 60 },
  { id: 'extra', label: 'Extra Deck', min: 0, max: 15 },
  { id: 'side', label: 'Side Deck', min: 0, max: 15 }
]

export const DECK_FORMATS: Record<GameId, readonly DeckFormat[]> = {
  ygo: [
    { id: 'advanced', label: 'Advanced (TCG)', sections: YGO_SECTIONS, priceRegion: 'en' },
    { id: 'ocg', label: 'OCG', sections: YGO_SECTIONS, priceRegion: 'asia' }
  ],
  pkm: [],
  op: [],
  mtg: []
}

export function formatOf(game: GameId, id: string): DeckFormat | null {
  return DECK_FORMATS[game].find((f) => f.id === id) ?? null
}

export function decksAvailable(game: GameId): boolean {
  return DECK_FORMATS[game].length > 0
}

/** Where a card goes when added without a section picked: Extra Deck monsters to Extra, else Main. */
export function defaultSection(game: GameId, card: DeckCard | undefined): DeckSection {
  return game === 'ygo' && card && isExtraFrame(card.frameType) ? 'extra' : 'main'
}
