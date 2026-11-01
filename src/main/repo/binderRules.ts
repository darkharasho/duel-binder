import type { SqlDb } from '../db/sql'
import type { Language } from '../../shared/languages'
import type { BinderRules, RuleField } from '../../shared/binders'
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
export function ruleSql(rules: BinderRules, languages: Language[], _scope: Scope): { sql: string; params: unknown[] } {
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
      parts.push('EXISTS (SELECT 1 FROM json_each(pc.types) WHERE value IN (SELECT value FROM json_each(?)))')
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
  LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
  WHERE +p.game = ${scope.game}`

/** How many printings meet the rules, counting at most `cap + 1` (so a caller can tell "over the cap"). */
export function matchedPrintingCount(
  db: SqlDb,
  rules: BinderRules,
  languages: Language[],
  scope: Scope,
  cap: number
): number {
  const w = ruleSql(rules, languages, scope)
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 ${FROM(scope)} AND ${w.sql} LIMIT ?)`)
    .get(...w.params, cap + 1) as { n: number }
  return row.n
}

/** Up to 50 distinct, non-empty values of `field` containing `q`, for the rule editor's suggestions. */
export function ruleFieldValues(db: SqlDb, field: RuleField, q: string, scope: Scope): string[] {
  const like = `%${escapeLike(q.trim())}%`
  let sql: string
  const params: unknown[] = []
  if (field === 'energyType') {
    sql = `SELECT DISTINCT j.value AS v FROM pokemon_cards pc
      JOIN cards c ON c.id = pc.card_id AND +c.game = ${scope.game}, json_each(pc.types) j
      WHERE j.value <> '' AND j.value LIKE ? ESCAPE '\\' ORDER BY v LIMIT 50`
    params.push(like)
  } else {
    const col = field === 'name' ? 'c.name' : COLUMN[field]
    if (!col) return []
    sql = `SELECT DISTINCT CAST(${col} AS TEXT) AS v ${FROM(scope)}
      AND ${col} IS NOT NULL AND CAST(${col} AS TEXT) <> '' AND CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'
      ORDER BY v LIMIT 50`
    params.push(like)
  }
  return (db.prepare(sql).all(...params) as { v: string }[]).map((r) => r.v)
}
