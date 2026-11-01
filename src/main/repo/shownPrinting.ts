import type { Scope } from './scope'

/**
 * SQL condition: printing alias `p` is one to list. A Pokémon printing flagged `missing_from_api`
 * is one its sources no longer show (often a finish the card was never printed in, which the
 * catalog keeps flagged instead of deleting). It is listed only while one of the scope's entries
 * is on it, so that copy keeps its row, price and "No longer in database" badge, and nobody is
 * offered it for a new copy. Yu-Gi-Oh! printings are always listed, but for the same rule on a
 * rarity of one digit: YGOPRODeck gives a Legendary Decks card's quantity as a second printing of
 * it, beside its real rarity.
 */
export const shownPrinting = (scope: Scope): string =>
  `(((p.game <> 'pkm' OR p.missing_from_api = 0) AND p.set_rarity NOT GLOB '[0-9]') OR p.id IN (SELECT printing_id FROM collection_entries e WHERE ${scope.where('e')}))`
