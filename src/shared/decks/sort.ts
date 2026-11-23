import type { GameId } from '../games'
import { pkmKind } from './pokemon/keys'
import type { DeckCard, DeckEntry } from './types'

/** Monsters 0, spells 1, traps 2, anything else (or a card missing from the map) 3. */
function ygoRank(card: DeckCard | undefined): number {
  if (!card) return 3
  if (card.type.includes('Monster')) return 0
  if (card.type.includes('Spell')) return 1
  if (card.type.includes('Trap')) return 2
  return 3
}

/** Pokémon 0, Trainer 1, Energy 2, anything else (or a card missing from the map) 3. */
function pkmRank(card: DeckCard | undefined): number {
  const k = card ? pkmKind(card.type) : null
  return k === 'P' ? 0 : k === 'T' ? 1 : k === 'E' ? 2 : 3
}

const OP_RANK: Record<string, number> = { Leader: 0, Character: 1, Event: 2, Stage: 3 }

/** Leader 0, Character 1, Event 2, Stage 3, anything else (or a card missing from the map) 4. */
function opRank(card: DeckCard | undefined): number {
  return OP_RANK[card?.opCardType ?? ''] ?? 4
}

/** One Piece within a rank: cost ascending (none last), then card number; 0 = tie. */
function opOrder(a: DeckCard | undefined, b: DeckCard | undefined): number {
  const ac = a?.opCost ?? Infinity
  const bc = b?.opCost ?? Infinity
  if (ac !== bc) return ac < bc ? -1 : 1
  const an = a?.opNumber ?? ''
  const bn = b?.opNumber ?? ''
  return an === bn ? 0 : an < bn ? -1 : 1
}

const MTG_TYPES = [
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land'
]

/** The first of the main Magic types in the front face's type line, else 8. */
function mtgRank(card: DeckCard | undefined): number {
  const i = MTG_TYPES.findIndex((t) => card?.mtgTypeLine?.includes(t))
  return i < 0 ? 8 : i
}

/** Magic within a rank: mana value ascending (none last); 0 = tie. */
function mtgOrder(a: DeckCard | undefined, b: DeckCard | undefined): number {
  const am = a?.mtgManaValue ?? Infinity
  const bm = b?.mtgManaValue ?? Infinity
  return am === bm ? 0 : am < bm ? -1 : 1
}

/** A sorted copy for display and export; entries that tie keep their given order. */
export function sortEntries(
  game: GameId,
  entries: DeckEntry[],
  cards: Record<number, DeckCard>
): DeckEntry[] {
  const rank = (e: DeckEntry): number =>
    game === 'mtg'
      ? (e.section === 'commander' ? 0 : 9) + mtgRank(cards[e.card])
      : game === 'ygo'
        ? ygoRank(cards[e.card])
        : game === 'pkm'
          ? pkmRank(cards[e.card])
          : game === 'op'
            ? opRank(cards[e.card])
            : 0
  return [...entries].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    if (game === 'mtg') {
      const o = mtgOrder(cards[a.card], cards[b.card])
      if (o !== 0) return o
    }
    if (game === 'op') {
      const o = opOrder(cards[a.card], cards[b.card])
      if (o !== 0) return o
    }
    const an = cards[a.card]?.name ?? ''
    const bn = cards[b.card]?.name ?? ''
    if (an !== bn) return an < bn ? -1 : 1
    return a.card - b.card
  })
}
