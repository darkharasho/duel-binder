import type { GameId } from '../games'
import type { DeckCard, DeckEntry } from './types'

/** Monsters 0, spells 1, traps 2, anything else (or a card missing from the map) 3. */
function ygoRank(card: DeckCard | undefined): number {
  if (!card) return 3
  if (card.type.includes('Monster')) return 0
  if (card.type.includes('Spell')) return 1
  if (card.type.includes('Trap')) return 2
  return 3
}

/** A sorted copy for display and export; entries that tie keep their given order. */
export function sortEntries(game: GameId, entries: DeckEntry[], cards: Record<number, DeckCard>): DeckEntry[] {
  const rank = (e: DeckEntry): number => (game === 'ygo' ? ygoRank(cards[e.card]) : 0)
  return [...entries].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    const an = cards[a.card]?.name ?? ''
    const bn = cards[b.card]?.name ?? ''
    if (an !== bn) return an < bn ? -1 : 1
    return a.card - b.card
  })
}
