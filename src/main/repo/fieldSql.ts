import type { GameId } from '../../shared/games/types'

/**
 * SQL conditions on a `card_printings` alias for a list of sets or rarities. Each list goes in as
 * one JSON parameter, never one per entry: the portal's DO SQLite refuses a statement with more
 * than 100 bound parameters, and a common word ("promo", "deck") matches hundreds of sets.
 */
export interface Cond {
  sql: string
  params: unknown[]
}

/** The printing is in one of `sets` (language and set name). */
export function inSets(alias: string, sets: { language: string; setName: string }[]): Cond {
  return {
    sql: `(${alias}.language, ${alias}.set_name) IN
      (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))`,
    params: [JSON.stringify(sets.map((s) => [s.language, s.setName]))]
  }
}

/** The printing's `col` is one of `values`. */
export function inValues(col: string, values: readonly unknown[]): Cond {
  return { sql: `${col} IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(values)] }
}

/**
 * The printing has one of `rarities`. A Pokémon printing's `set_rarity` is its finish ("Holofoil",
 * "Reverse Holofoil"); the card's rarity ("Special Illustration Rare") is `pokemon_cards.rarity`,
 * so a Pokémon label matches either.
 */
export function inRarities(alias: string, game: GameId, rarities: readonly string[]): Cond {
  const list = JSON.stringify(rarities)
  if (game !== 'pkm')
    return { sql: `${alias}.set_rarity IN (SELECT value FROM json_each(?))`, params: [list] }
  return {
    sql: `(${alias}.set_rarity IN (SELECT value FROM json_each(?))
      OR ${alias}.card_id IN (SELECT card_id FROM pokemon_cards WHERE rarity IN (SELECT value FROM json_each(?))))`,
    params: [list, list]
  }
}
