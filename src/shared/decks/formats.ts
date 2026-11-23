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

const PKM_SECTIONS: SectionDef[] = [{ id: 'main', label: 'Deck', min: 60, max: 60 }]

const OP_SECTIONS: SectionDef[] = [
  { id: 'leader', label: 'Leader', min: 1, max: 1 },
  { id: 'main', label: 'Deck', min: 50, max: 50 }
]

const MTG_SECTIONS: SectionDef[] = [
  { id: 'main', label: 'Main', min: 60, max: Infinity },
  { id: 'side', label: 'Sideboard', min: 0, max: 15 }
]

const MTG_COMMANDER_SECTIONS: SectionDef[] = [
  { id: 'commander', label: 'Commander', min: 1, max: 2 },
  { id: 'main', label: 'Main', min: 0, max: Infinity }
]

export const DECK_FORMATS: Record<GameId, readonly DeckFormat[]> = {
  ygo: [
    { id: 'advanced', label: 'Advanced (TCG)', sections: YGO_SECTIONS, priceRegion: 'en' },
    { id: 'ocg', label: 'OCG', sections: YGO_SECTIONS, priceRegion: 'asia' }
  ],
  pkm: [
    { id: 'standard', label: 'Standard', sections: PKM_SECTIONS, priceRegion: 'en' },
    { id: 'expanded', label: 'Expanded', sections: PKM_SECTIONS, priceRegion: 'en' }
  ],
  op: [
    { id: 'standard', label: 'Standard', sections: OP_SECTIONS, priceRegion: 'en' },
    { id: 'extra', label: 'Extra Regulation', sections: OP_SECTIONS, priceRegion: 'en' }
  ],
  mtg: [
    { id: 'standard', label: 'Standard', sections: MTG_SECTIONS, priceRegion: 'en' },
    { id: 'pioneer', label: 'Pioneer', sections: MTG_SECTIONS, priceRegion: 'en' },
    { id: 'modern', label: 'Modern', sections: MTG_SECTIONS, priceRegion: 'en' },
    { id: 'legacy', label: 'Legacy', sections: MTG_SECTIONS, priceRegion: 'en' },
    { id: 'vintage', label: 'Vintage', sections: MTG_SECTIONS, priceRegion: 'en' },
    { id: 'pauper', label: 'Pauper', sections: MTG_SECTIONS, priceRegion: 'en' },
    { id: 'commander', label: 'Commander', sections: MTG_COMMANDER_SECTIONS, priceRegion: 'en' }
  ]
}

export function formatOf(game: GameId, id: string): DeckFormat | null {
  return DECK_FORMATS[game].find((f) => f.id === id) ?? null
}

export function decksAvailable(game: GameId): boolean {
  return DECK_FORMATS[game].length > 0
}

/**
 * Where a card goes when added without a section picked: Extra Deck monsters to Extra, a One Piece
 * Leader to Leader, a Magic Commander deck's first legendary creature to Commander, else Main.
 */
export function defaultSection(
  game: GameId,
  card:
    | (Pick<DeckCard, 'frameType' | 'opCardType'> & Partial<Pick<DeckCard, 'mtgTypeLine'>>)
    | undefined,
  ctx?: { format: string; commanders: number }
): DeckSection {
  if (game === 'mtg') {
    const front = card?.mtgTypeLine?.split(' // ')[0] ?? ''
    return ctx?.format === 'commander' &&
      ctx.commanders === 0 &&
      front.includes('Legendary') &&
      front.includes('Creature')
      ? 'commander'
      : 'main'
  }
  if (game === 'op') return card?.opCardType === 'Leader' ? 'leader' : 'main'
  return game === 'ygo' && card && isExtraFrame(card.frameType) ? 'extra' : 'main'
}
