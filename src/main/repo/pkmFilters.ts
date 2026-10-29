import type { SqlDb } from '../db/sql'
import type { Scope } from './scope'

interface PokemonFilterFields {
  pkmCategories?: string[]
  pkmTypes?: string[]
  pkmStages?: string[]
  hpMin?: number
  hpMax?: number
}

/**
 * WHERE fragments for the Pokémon-only filters, against a cards alias `c`. Details live in
 * `pokemon_cards` (joined on card_id); `types` is a JSON array, matched with json_each.
 */
export function pokemonWhere(f: PokemonFilterFields): { where: string[]; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []
  const marks = (v: string[]): string => v.map(() => '?').join(',')
  if (f.pkmCategories?.length) {
    where.push(
      `c.id IN (SELECT card_id FROM pokemon_cards WHERE category IN (${marks(f.pkmCategories)}))`
    )
    params.push(...f.pkmCategories)
  }
  if (f.pkmStages?.length) {
    where.push(`c.id IN (SELECT card_id FROM pokemon_cards WHERE stage IN (${marks(f.pkmStages)}))`)
    params.push(...f.pkmStages)
  }
  if (f.pkmTypes?.length) {
    where.push(
      `c.id IN (SELECT pc.card_id FROM pokemon_cards pc, json_each(pc.types) jt WHERE jt.value IN (${marks(f.pkmTypes)}))`
    )
    params.push(...f.pkmTypes)
  }
  if (f.hpMin !== undefined) {
    where.push('c.id IN (SELECT card_id FROM pokemon_cards WHERE hp >= ?)')
    params.push(f.hpMin)
  }
  if (f.hpMax !== undefined) {
    where.push('c.id IN (SELECT card_id FROM pokemon_cards WHERE hp <= ?)')
    params.push(f.hpMax)
  }
  return { where, params }
}

/**
 * Distinct category, type and stage values of the scope's Pokémon cards, limited to the card ids
 * `cardIds` selects (a SQL subquery), or all of them when null.
 */
export function pokemonFacets(
  db: SqlDb,
  scope: Scope,
  cardIds: string | null
): { pkmCategories: string[]; pkmTypes: string[]; pkmStages: string[] } {
  const src = `SELECT pc.* FROM pokemon_cards pc JOIN cards c ON c.id = pc.card_id AND +c.game = ${scope.game}${
    cardIds ? ` WHERE pc.card_id IN (${cardIds})` : ''
  }`
  const values = (sql: string): string[] =>
    (db.prepare(sql).all() as { v: string }[]).map((r) => r.v)
  return {
    pkmCategories: values(
      `SELECT DISTINCT category AS v FROM (${src}) WHERE category <> '' ORDER BY v`
    ),
    pkmTypes: values(
      `SELECT DISTINCT jt.value AS v FROM (${src}) s, json_each(s.types) jt ORDER BY v`
    ),
    pkmStages: values(
      `SELECT DISTINCT stage AS v FROM (${src}) WHERE stage IS NOT NULL AND stage <> '' ORDER BY v`
    )
  }
}
