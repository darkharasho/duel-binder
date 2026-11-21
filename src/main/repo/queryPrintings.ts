import type { SqlDb } from '../db/sql'
import type { TermTarget } from '../../shared/search/terms'
import { termWords } from '../../shared/search/terms'
import { buildFtsQuery } from './fts'
import { fieldPrintingIds, parseFields, type FieldQuery } from './queryFields'
import { matchTerms, termPrintingIds } from './searchTerms'
import type { Scope } from './scope'

/** How many of a term's printings a narrowing word is checked against. */
export const TERM_POOL = 500
/** How many name matches are checked for one that spells the whole query. */
const NAME_POOL = 300

/**
 * What narrows a term's printings: the field words beside it, else its leftover words as a name.
 * Null when the term stands alone.
 */
export function termNarrowing(db: SqlDb, scope: Scope, rest: string[]): FieldQuery | null {
  if (rest.length === 0) return null
  return (
    parseFields(db, scope, rest, true) ?? {
      sets: null,
      rarities: null,
      codePrefix: null,
      number: null,
      nameWords: rest
    }
  )
}

/** A term's printing ids (English first), cut at `limit`, kept only where `narrow` matches. */
export function termIds(
  db: SqlDb,
  scope: Scope,
  target: TermTarget,
  narrow: FieldQuery | null,
  limit: number
): number[] {
  const ids = termPrintingIds(db, scope, target, narrow ? TERM_POOL : limit)
  if (!narrow) return ids
  const within = new Set(fieldPrintingIds(db, scope, narrow, TERM_POOL, ids))
  return ids.filter((id) => within.has(id))
}

/** Whether every query word is a word of `name`, the last one maybe only its start. */
export function spellsName(words: string[], name: string): boolean {
  if (words.length === 0) return false
  const nameWords = termWords(name)
  return words.every((w, i) =>
    i === words.length - 1 ? nameWords.some((n) => n.startsWith(w)) : nameWords.includes(w)
  )
}

/** Whether a card of the game the name search finds has a name spelling every query word. */
function nameSpelled(db: SqlDb, scope: Scope, words: string[]): boolean {
  const fts = buildFtsQuery(words.join(' '))
  if (!fts) return false
  const names = db
    .prepare(
      `SELECT c.name FROM cards_fts JOIN cards c ON c.id = cards_fts.rowid
       WHERE cards_fts MATCH ? AND +c.game = ${scope.game} ORDER BY bm25(cards_fts) LIMIT ${NAME_POOL}`
    )
    .all(fts) as { name: string }[]
  return names.some((n) => spellsName(words, n.name))
}

/**
 * The printings a query's approved terms and set, rarity, code and number words name, the way
 * searchCards finds its version rows: each term's printings (narrowed by the words beside it),
 * then the field words' printings, unless a card's name spells the whole query ("dark magician").
 * `term` is the matched phrases; the first `fromTerms` ids came from terms, the rest from field
 * words. Null when the query has neither.
 */
export function queryPrintingIds(
  db: SqlDb,
  scope: Scope,
  text: string,
  limit = 2000
): { ids: number[]; term: string | null; fromTerms: number } | null {
  const words = termWords(text)
  if (words.length === 0) return null
  const { matches, rest } = matchTerms(db, scope, text)
  const ids = new Set<number>()
  const add = (found: number[]): void => {
    for (const id of found) if (ids.size < limit) ids.add(id)
  }
  if (matches.length > 0) {
    const narrow = termNarrowing(db, scope, rest)
    for (const m of matches) add(termIds(db, scope, m.term.target, narrow, limit))
  }
  const fromTerms = ids.size
  const fq = ids.size < limit ? parseFields(db, scope, words) : null
  const fields = fq !== null && !nameSpelled(db, scope, words)
  if (fields) add(fieldPrintingIds(db, scope, fq, limit))
  if (matches.length === 0 && !fields) return null
  return {
    ids: [...ids],
    term: matches.length > 0 ? matches.map((m) => m.term.phrase).join(' ') : null,
    fromTerms
  }
}
