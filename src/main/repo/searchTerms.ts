import type { SqlDb } from '../db/sql'
import type { GameId } from '../../shared/games/types'
import {
  MAX_TERM_WORDS,
  termWords,
  type SearchTerm,
  type TermTarget
} from '../../shared/search/terms'
import { scopeGame, type Scope } from './scope'

interface TermDbRow {
  id: number
  game: string
  phrase: string
  phrase_key: string
  kind: string
  target_kind: string
  target: string
  status: string
  source: string
  seq: number
}

const cache = new WeakMap<SqlDb, Map<GameId, SearchTerm[]>>()

function parseTarget(json: string): TermTarget {
  try {
    const t = JSON.parse(json)
    return t && typeof t === 'object' ? (t as TermTarget) : {}
  } catch {
    return {}
  }
}

/** The approved terms of a game, loaded once per db until `forgetSearchTerms`. */
export function approvedTerms(db: SqlDb, game: GameId): SearchTerm[] {
  let byGame = cache.get(db)
  if (!byGame) cache.set(db, (byGame = new Map()))
  const hit = byGame.get(game)
  if (hit) return hit
  const rows = db
    .prepare(
      `SELECT id, game, phrase, phrase_key, kind, target_kind, target, status, source, seq
       FROM search_terms WHERE game = ? AND status = 'approved'`
    )
    .all(game) as TermDbRow[]
  const terms = rows.map(
    (r) =>
      ({
        id: r.id,
        game: r.game,
        phrase: r.phrase,
        phraseKey: r.phrase_key,
        kind: r.kind,
        targetKind: r.target_kind,
        target: parseTarget(r.target),
        status: r.status,
        source: r.source,
        seq: r.seq
      }) as SearchTerm
  )
  byGame.set(game, terms)
  return terms
}

/** Drops the cached terms of `db`; every writer of `search_terms` calls it. */
export function forgetSearchTerms(db: SqlDb): void {
  cache.delete(db)
}

export interface TermMatch {
  term: SearchTerm
  /** Word indexes into the query's words; `end` is exclusive. */
  start: number
  end: number
}

/** Greedy longest-first match of approved terms over whole words; `rest` is the uncovered words. */
export function matchTerms(
  db: SqlDb,
  scope: Scope,
  text: string
): { matches: TermMatch[]; rest: string[] } {
  const words = termWords(text)
  const byKey = new Map(approvedTerms(db, scopeGame(db, scope)).map((t) => [t.phraseKey, t]))
  const matches: TermMatch[] = []
  const rest: string[] = []
  let i = 0
  while (i < words.length) {
    let found: TermMatch | null = null
    for (let n = Math.min(MAX_TERM_WORDS, words.length - i); n >= 1 && !found; n--) {
      const term = byKey.get(words.slice(i, i + n).join(' '))
      if (term) found = { term, start: i, end: i + n }
    }
    if (found) {
      matches.push(found)
      i = found.end
    } else rest.push(words[i++])
  }
  return { matches, rest }
}

/**
 * Local printing ids a term target names, English printings first then by id, cut at `limit`.
 * Kinds with entries are ANDed; empty or missing kinds are ignored; a target with none gives [].
 * `within` keeps only those ids (a collection's owned printings).
 */
export function termPrintingIds(
  db: SqlDb,
  scope: Scope,
  target: TermTarget,
  limit: number,
  within?: number[]
): number[] {
  const conds: string[] = []
  const params: unknown[] = []
  // An empty list is the same as a missing one: unset kinds are skipped, not ANDed.
  const inList = (col: string, values: unknown[] | undefined): void => {
    if (!values || values.length === 0) return
    conds.push(`${col} IN (${values.map(() => '?').join(',')})`)
    params.push(...values)
  }
  inList('p.pkey', target.pkeys)
  inList('p.card_id', target.cardIds)
  inList('p.set_rarity', target.rarities)
  if (target.sets && target.sets.length > 0) {
    conds.push(`(${target.sets.map(() => '(p.language = ? AND p.set_name = ?)').join(' OR ')})`)
    for (const s of target.sets) params.push(s.language, s.setName)
  }
  if (conds.length === 0) return []
  if (within) {
    // One JSON parameter, not one per id: the portal's SQLite caps bound parameters.
    conds.push('p.id IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(within))
  }
  return (
    db
      .prepare(
        `SELECT p.id FROM card_printings p
         WHERE +p.game = ${scope.game} AND p.contributed = 0 AND ${conds.join(' AND ')}
         ORDER BY p.language = 'en' DESC, p.id LIMIT ?`
      )
      .all(...params, limit) as { id: number }[]
  ).map((r) => r.id)
}
