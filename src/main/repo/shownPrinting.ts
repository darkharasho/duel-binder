import type { Scope } from './scope'

/**
 * SQL condition: printing alias `p` is one to list. A printing the catalog flags
 * `missing_from_api` is one its sources no longer show (for Pokémon, a finish the card was never
 * printed in, which the catalog keeps flagged instead of deleting). It is listed only while one
 * of the scope's entries is on it, so that copy keeps its row, price and "No longer in database"
 * badge, and nobody is offered it for a new copy. Yu-Gi-Oh! printings are only flagged while
 * some entry is on them (an unowned one is deleted instead), so they are barely affected.
 */
export const shownPrinting = (scope: Scope): string =>
  `(p.missing_from_api = 0 OR p.id IN (SELECT printing_id FROM collection_entries e WHERE ${scope.where('e')}))`
