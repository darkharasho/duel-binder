import type { SqlDb } from '../db/sql'
import type { Scope } from './scope'
import { buildFtsQuery } from './fts'

interface PokemonFilterFields {
  pkmCategories?: string[]
  pkmTypes?: string[]
  pkmStages?: string[]
  pkmRarities?: string[]
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
  if (f.pkmRarities?.length) {
    where.push(
      `c.id IN (SELECT card_id FROM pokemon_cards WHERE rarity IN (${marks(f.pkmRarities)}))`
    )
    params.push(...f.pkmRarities)
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
 * Distinct category, type, stage and rarity values of the scope's Pokémon cards, limited to the card ids
 * `cardIds` selects (a SQL subquery), or all of them when null.
 */
export function pokemonFacets(
  db: SqlDb,
  scope: Scope,
  cardIds: string | null
): { pkmCategories: string[]; pkmTypes: string[]; pkmStages: string[]; pkmRarities: string[] } {
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
    ),
    pkmRarities: values(
      `SELECT DISTINCT rarity AS v FROM (${src}) WHERE rarity IS NOT NULL AND rarity <> '' ORDER BY v`
    )
  }
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * The number in a Pokémon printing's `set_code`: the part before the `/` of `{abbrev} {localId}/{official}`,
 * or the whole code when it has no count (a promo's `MEP 102`, `SV-P 271`, most Chinese sets'
 * `CSV10C 001`), as its trailing run of digits when a space precedes it, else NULL (so `TG05`
 * and `MEP Museum` have no number). `col` is the set_code column, e.g. `p.set_code`.
 */
function numberPart(col: string): string {
  const head = `(CASE WHEN instr(${col}, '/') > 0 THEN substr(${col}, 1, instr(${col}, '/') - 1) ELSE ${col} END)`
  const rest = `rtrim(${head}, '0123456789')`
  return `(CASE WHEN length(${head}) > length(${rest}) AND substr(${rest}, -1) = ' '
    THEN CAST(substr(${head}, length(${rest}) + 1) AS INTEGER) END)`
}

/** SQL (with one `?` per param) that is true when a printing's number matches a typed `45`, `045` or `45/193`. */
export function pokemonNumberMatch(
  text: string,
  col: string
): { sql: string; params: unknown[] } | null {
  if (/^\d+$/.test(text)) return { sql: `${numberPart(col)} = ?`, params: [Number(text)] }
  const m = /^(\d+)\/(\d+)$/.exec(text)
  if (!m) return null
  const count = `substr(${col}, instr(${col}, '/') + 1)`
  return {
    sql: `(${numberPart(col)} = ? AND ${count} NOT GLOB '*[^0-9]*' AND ${count} <> '' AND CAST(${count} AS INTEGER) = ?)`,
    params: [Number(m[1]), Number(m[2])]
  }
}

/** Words, then a card number as pokemonNumberMatch reads one: "Victini 102", "MEP 102", "Pikachu 45/193". */
const NAMED_NUMBER = /^(.*?\S)\s+(\d+(?:\/\d+)?)$/

/**
 * SQL (with one `?` per param) true when a printing has the number a typed "{words} {number}"
 * ends with, and its card is named by the words (in English, by its FTS name; or its local name)
 * or its set code starts with them ("MEP 102", "SV-P 271"). A name shared by many cards is found
 * by one printing so. `col` is the printing's set_code, `cardId` its card id. Null for other text.
 */
export function pokemonNamedNumber(
  text: string,
  col: string,
  cardId: string
): { sql: string; params: unknown[] } | null {
  const m = NAMED_NUMBER.exec(text.trim())
  if (!m) return null
  const num = pokemonNumberMatch(m[2], col)
  if (!num) return null
  const words = m[1]
  const fts = buildFtsQuery(words)
  const named = [
    `${col} LIKE ? ESCAPE '\\'`,
    `${cardId} IN (SELECT card_id FROM pokemon_cards WHERE local_name LIKE ? ESCAPE '\\')`,
    ...(fts ? [`${cardId} IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?)`] : [])
  ]
  return {
    sql: `(${num.sql} AND (${named.join(' OR ')}))`,
    params: [
      ...num.params,
      `${escapeLike(words)} %`,
      `%${escapeLike(words)}%`,
      ...(fts ? [fts] : [])
    ]
  }
}

/**
 * OR-alternatives (against a cards alias `c`) for a Pokémon search. A card number (`45`, `45/193`)
 * matches printing numbers and nothing else (`numeric`); any other text matches the card's Japanese
 * name, or a printing by name and number (pokemonNamedNumber), and the caller adds its own name and
 * set-code matches. With `printingCol` (an alias's
 * set_code) the number is tested on that printing, else on any of the card's printings in `game`.
 */
export function pokemonSearch(
  text: string,
  o: { game: string; printingCol?: string }
): { numeric: boolean; parts: string[]; params: unknown[] } {
  const num = pokemonNumberMatch(text, o.printingCol ?? 'set_code')
  if (num) {
    const sql = o.printingCol
      ? num.sql
      : `c.id IN (SELECT card_id FROM card_printings WHERE +game = ${o.game} AND contributed = 0 AND ${num.sql})`
    return { numeric: true, parts: [sql], params: num.params }
  }
  const parts = [`c.id IN (SELECT card_id FROM pokemon_cards WHERE local_name LIKE ? ESCAPE '\\')`]
  const params: unknown[] = [`%${escapeLike(text)}%`]
  const named = o.printingCol
    ? pokemonNamedNumber(text, o.printingCol, 'c.id')
    : pokemonNamedNumber(text, 'np.set_code', 'np.card_id')
  if (named) {
    parts.push(
      o.printingCol
        ? named.sql
        : `c.id IN (SELECT np.card_id FROM card_printings np WHERE +np.game = ${o.game} AND np.contributed = 0 AND ${named.sql})`
    )
    params.push(...named.params)
  }
  return { numeric: false, parts, params }
}
