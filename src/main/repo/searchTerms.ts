import type { SqlDb } from '../db/sql'
import type { GameId } from '../../shared/games/types'
import {
  MAX_TERM_WORDS,
  termWords,
  type SearchTerm,
  type TermTarget
} from '../../shared/search/terms'
import { inRarities, inSets, inValues, type Cond } from './fieldSql'
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
 * Local printing ids a term names, English printings first then by id, cut at `limit`. Only the list
 * its target kind names is read (pkeys, card ids, sets or rarities); an empty or missing one gives
 * []. `within` keeps only those ids (a collection's owned printings). Every list goes in as one JSON
 * parameter: the portal's DO SQLite refuses more than 100 bound parameters.
 */
export function termPrintingIds(
  db: SqlDb,
  scope: Scope,
  term: Pick<SearchTerm, 'targetKind' | 'target'>,
  limit: number,
  within?: number[]
): number[] {
  const { target, targetKind } = term
  let cond: Cond
  switch (targetKind) {
    case 'printing':
      if (!target.pkeys?.length) return []
      cond = inValues('p.pkey', target.pkeys)
      break
    case 'card':
    case 'cards':
      if (!target.cardIds?.length) return []
      cond = inValues('p.card_id', target.cardIds)
      break
    case 'set':
      if (!target.sets?.length) return []
      cond = inSets('p', target.sets)
      break
    case 'rarity':
      if (!target.rarities?.length) return []
      cond = inRarities('p', scopeGame(db, scope), target.rarities)
      break
    default:
      return []
  }
  const conds = [cond.sql]
  const params = [...cond.params]
  if (within) {
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
