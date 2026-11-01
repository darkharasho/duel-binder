import type { SqlDb } from '../db/sql'
import type { Language } from '../../shared/languages'
import {
  MAX_BINDER_MATCHES,
  type BinderRule,
  type BinderRules,
  type RuleField
} from '../../shared/binders'
import { escapeLike } from './cards'
import type { Scope } from './scope'

/** Scalar SQL expression per multi-value field (aliases p = card_printings, c = cards, pc = pokemon_cards). */
const COLUMN: Partial<Record<RuleField, string>> = {
  artist: 'pc.illustrator',
  cardType: 'c.type',
  frameType: 'c.frame_type',
  race: 'c.race',
  category: 'c.type',
  stage: 'pc.stage',
  attribute: 'c.attribute',
  level: 'COALESCE(c.level, c.linkval)',
  archetype: 'c.archetype',
  set: 'p.set_name',
  rarity: 'p.set_rarity'
}

/**
 * Boolean SQL over aliases p, c and pc (LEFT JOIN pokemon_cards), true for a printing that meets
 * every rule and, when `languages` is not empty, is in one of them. No WHERE; values are bound.
 */
export function ruleSql(
  rules: BinderRules,
  languages: Language[]
): { sql: string; params: unknown[] } {
  const parts: string[] = []
  const params: unknown[] = []
  for (const rule of rules.rules) {
    if (rule.field === 'name') {
      if (rule.op === 'is') {
        parts.push('(c.name = ? COLLATE NOCASE OR pc.local_name = ? COLLATE NOCASE)')
        params.push(rule.value, rule.value)
      } else {
        const like = `%${escapeLike(rule.value)}%`
        parts.push("(c.name LIKE ? ESCAPE '\\' OR pc.local_name LIKE ? ESCAPE '\\')")
        params.push(like, like)
      }
    } else if (rule.field === 'energyType') {
      parts.push(
        'EXISTS (SELECT 1 FROM json_each(pc.types) WHERE value IN (SELECT value FROM json_each(?)))'
      )
      params.push(JSON.stringify(rule.values))
    } else {
      const col = COLUMN[rule.field]
      if (!col) throw new Error(`Unknown rule field: ${rule.field}`)
      // Levels are stored as integers; the rule keeps them as text.
      const sel = rule.field === 'level' ? 'CAST(value AS INTEGER)' : 'value'
      parts.push(`${col} IN (SELECT ${sel} FROM json_each(?))`)
      params.push(JSON.stringify(rule.values))
    }
  }
  if (languages.length) {
    parts.push('p.language IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(languages))
  }
  return { sql: parts.length ? parts.join(' AND ') : '1', params }
}

const FROM = (scope: Scope): string => `
  FROM card_printings p
  JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
  LEFT JOIN pokemon_cards pc ON pc.card_id = c.id AND ${scope.game} = 'pkm'
  WHERE +p.game = ${scope.game}`

/** Read from the printing itself. Every other field is the card's. */
const onPrinting = (field: RuleField): boolean => field === 'set' || field === 'rarity'

/** Card fields with an index to find cards by. */
const CARD_INDEXED: ReadonlySet<RuleField> = new Set<RuleField>(['artist', 'archetype'])

/** Card fields only a Pokémon card has: a card without a pokemon_cards row can't meet them. */
const POKEMON_ONLY: ReadonlySet<RuleField> = new Set<RuleField>(['artist', 'stage', 'energyType'])

type NameRule = Extract<BinderRule, { field: 'name' }>

/** Card lookups already run, so binders read in one call can share them. */
export type CardLookups = Map<string, number[]>

/**
 * Ids of the scope's cards meeting `where`, read with or without pokemon_cards (alias pc). `game`
 * comes last: it sits behind the card text in a row, so most rows should fail before reading it.
 */
function cardIds(
  db: SqlDb,
  join: 'none' | 'inner' | 'left',
  where: { sql: string; params: unknown[] },
  scope: Scope,
  lookups?: CardLookups
): number[] {
  const pc = { none: '', inner: 'JOIN', left: 'LEFT JOIN' }[join]
  const sql = `SELECT c.id FROM cards c ${pc && `${pc} pokemon_cards pc ON pc.card_id = c.id`}
       WHERE ${where.sql} AND +c.game = ${scope.game}`
  const key = `${sql}\0${JSON.stringify(where.params)}`
  const known = lookups?.get(key)
  if (known) return known
  const rows = db.prepare(sql).all(...where.params) as { id: number }[]
  const ids = rows.map((r) => r.id)
  lookups?.set(key, ids)
  return ids
}

/**
 * The cards that could meet the rules' card fields, or null when the printings have to drive: no
 * card field, or a set rule (indexed) with no indexed card field to beat it. Rarity alone is the
 * no-card-field case: it walks that rarity's printings unless it passes the cap, where LIMIT stops it.
 * It only narrows: a printing must still pass ruleSql, so a rule can't be met by two different
 * printings.
 *
 * A name is two lookups rather than an OR, which no index serves. Other rules join the lookup
 * only as far as they need pokemon_cards, since a join of every card costs more than the filter.
 */
function candidateCards(
  db: SqlDb,
  rules: BinderRules,
  scope: Scope,
  lookups?: CardLookups
): number[] | null {
  const cardRules = rules.rules.filter((r) => !onPrinting(r.field))
  if (cardRules.length === 0) return null
  const name = cardRules.find((r): r is NameRule => r.field === 'name')
  const indexed = cardRules.some((r) => CARD_INDEXED.has(r.field))
  if (name?.op !== 'is' && !indexed && rules.rules.some((r) => r.field === 'set')) return null

  const others = cardRules.filter((r) => r !== name)
  const rest = ruleSql({ ...rules, rules: others }, [])
  const pokemon = others.some((r) => POKEMON_ONLY.has(r.field))
  const nameTwice = others.some((r) => r.field === 'name')
  const join = pokemon ? 'inner' : 'none'
  if (nameTwice) return cardIds(db, 'left', rest, scope, lookups)
  if (!name) return cardIds(db, join, rest, scope, lookups)

  const exact = name.op === 'is'
  const test = (col: string): string =>
    exact ? `${col} = ? COLLATE NOCASE` : `${col} LIKE ? ESCAPE '\\'`
  const value = exact ? name.value : `%${escapeLike(name.value)}%`
  const by = (sql: string): { sql: string; params: unknown[] } => ({
    sql: `${sql} AND ${rest.sql}`,
    params: [value, ...rest.params]
  })
  const local = by(`${scope.game} = 'pkm' AND ${test('pc.local_name')}`)
  return [
    ...new Set([
      ...cardIds(db, join, by(test('c.name')), scope, lookups),
      ...cardIds(db, 'inner', local, scope, lookups)
    ])
  ]
}

/**
 * Most candidate cards to bind as one JSON value. Past this a card list stops narrowing much, and
 * the whole catalog's ids near the Durable Object's 2 MB string limit.
 */
export const MAX_CANDIDATE_CARDS = MAX_BINDER_MATCHES

/**
 * ruleSql for a printing query, with the printings narrowed to the cards that can match. Too many
 * candidates return the plain condition, which is just as correct: LIMIT stops it at the cap.
 */
export function narrowedRuleSql(
  db: SqlDb,
  rules: BinderRules,
  languages: Language[],
  scope: Scope,
  lookups?: CardLookups,
  maxCandidates = MAX_CANDIDATE_CARDS
): { sql: string; params: unknown[] } {
  const w = ruleSql(rules, languages)
  const cards = candidateCards(db, rules, scope, lookups)
  if (cards === null || cards.length > maxCandidates) return w
  return {
    sql: `p.card_id IN (SELECT value FROM json_each(?)) AND ${w.sql}`,
    params: [JSON.stringify(cards), ...w.params]
  }
}

/** How many printings meet the rules, counting at most `cap + 1` (so a caller can tell "over the cap"). */
export function matchedPrintingCount(
  db: SqlDb,
  rules: BinderRules,
  languages: Language[],
  scope: Scope,
  cap: number,
  w: { sql: string; params: unknown[] } = narrowedRuleSql(db, rules, languages, scope)
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 ${FROM(scope)} AND ${w.sql} LIMIT ?)`)
    .get(...w.params, cap + 1) as { n: number }
  return row.n
}

const MAX_FIELD_VALUES = 50

const POKEMON_VALUES = (scope: Scope): string => `pokemon_cards pc WHERE ${scope.game} = 'pkm'`

/** The one table a field's suggestions are read from, as `<table> WHERE <scope>`. */
const valueSource = (field: RuleField, scope: Scope): string =>
  onPrinting(field)
    ? `card_printings p WHERE +p.game = ${scope.game}`
    : POKEMON_ONLY.has(field)
      ? POKEMON_VALUES(scope)
      : `cards c WHERE +c.game = ${scope.game}`

function columnValues(
  db: SqlDb,
  col: string,
  source: string,
  like: string,
  isText: boolean
): string[] {
  // A CAST would hide a text column from its index, and the ORDER BY with it.
  const text = isText ? col : `CAST(${col} AS TEXT)`
  const rows = db
    .prepare(
      `SELECT DISTINCT ${text} AS v FROM ${source}
       AND ${text} <> '' AND ${text} LIKE ? ESCAPE '\\'
       ORDER BY v LIMIT ${MAX_FIELD_VALUES}`
    )
    .all(like) as { v: string }[]
  return rows.map((r) => r.v)
}

/**
 * Up to 50 distinct, non-empty values of `field` containing `q`, for the rule editor's suggestions.
 * Runs per debounced keystroke, on the Durable Object too, so each field reads only the table that
 * holds it. `game` stays unary in the indexed reads, as everywhere: it only filters what they walk.
 */
export function ruleFieldValues(db: SqlDb, field: RuleField, q: string, scope: Scope): string[] {
  const like = `%${escapeLike(q.trim())}%`
  if (field === 'energyType') {
    const sql = `SELECT DISTINCT j.value AS v FROM pokemon_cards pc
      JOIN cards c ON c.id = pc.card_id AND +c.game = ${scope.game}, json_each(pc.types) j
      WHERE j.value <> '' AND j.value LIKE ? ESCAPE '\\' ORDER BY v LIMIT ${MAX_FIELD_VALUES}`
    return (db.prepare(sql).all(like) as { v: string }[]).map((r) => r.v)
  }
  if (field === 'name') {
    // A name rule matches either name; two reads, since no compound SELECT runs on the server.
    const names = columnValues(db, 'c.name', valueSource(field, scope), like, true)
    const locals = columnValues(db, 'pc.local_name', POKEMON_VALUES(scope), like, true)
    return [...new Set([...names, ...locals])].sort().slice(0, MAX_FIELD_VALUES)
  }
  const col = COLUMN[field]
  if (!col) return []
  return columnValues(db, col, valueSource(field, scope), like, field !== 'level')
}
