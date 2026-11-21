import type { SqlDb } from '../db/sql'
import type { GameId } from '../../shared/games/types'
import { termKey, termWords } from '../../shared/search/terms'
import { buildFtsQuery } from './fts'
import { scopeGame, type Scope } from './scope'

export interface FieldQuery {
  sets: { language: string; setName: string }[] | null
  rarities: string[] | null
  codePrefix: string | null
  number: string | null
  nameWords: string[]
}

/** Short rarity words players type, mapped to the rarity label as printings carry it. */
export const RARITY_ABBREVIATIONS: Record<GameId, Record<string, string>> = {
  pkm: {
    sir: 'Special Illustration Rare',
    ir: 'Illustration Rare',
    ur: 'Ultra Rare',
    hr: 'Hyper Rare'
  },
  ygo: {
    qcse: 'Quarter Century Secret Rare',
    scr: 'Secret Rare',
    ur: 'Ultra Rare',
    str: 'Starlight Rare'
  },
  op: { sp: 'SP', sec: 'SEC' },
  mtg: {}
}

const MAX_SET_WORDS = 6
const MAX_RARITY_WORDS = 4
/** A last word shorter than this must equal a set-name word, not just start it. */
const MIN_PREFIX_LENGTH = 3

interface FieldLists {
  /** `sets` row count when loaded; a new set drops the lists. */
  stamp: number
  sets: { language: string; setName: string; words: string[] }[]
  /** Rarity labels as printings carry them, by termKey. */
  rarities: Map<string, string[]>
  /** Set-code prefixes (lowercase) of the game's sets. */
  codes: Set<string>
}

const cache = new WeakMap<SqlDb, Map<GameId, FieldLists>>()

/** The sets, rarity labels and code prefixes of a game, loaded once until the set list changes. */
function fieldLists(db: SqlDb, scope: Scope, game: GameId): FieldLists {
  const stamp = (db.prepare('SELECT COUNT(*) AS n FROM sets').get() as { n: number }).n
  let byGame = cache.get(db)
  if (!byGame) cache.set(db, (byGame = new Map()))
  const hit = byGame.get(game)
  if (hit && hit.stamp === stamp) return hit
  const setRows = db
    .prepare(`SELECT language, set_name, set_code FROM sets WHERE game = ${scope.game}`)
    .all() as { language: string; set_name: string; set_code: string }[]
  const codes = new Set<string>()
  for (const r of setRows) {
    const code = r.set_code.toLowerCase()
    codes.add(code)
    const head = code.split(':')[0]
    codes.add(head)
  }
  const rarities = new Map<string, string[]>()
  const labels = db
    .prepare(
      `SELECT DISTINCT set_rarity FROM card_printings WHERE +game = ${scope.game} AND contributed = 0`
    )
    .all() as { set_rarity: string }[]
  for (const { set_rarity } of labels) {
    const key = termKey(set_rarity)
    if (!key) continue
    const list = rarities.get(key)
    if (list) list.push(set_rarity)
    else rarities.set(key, [set_rarity])
  }
  const lists: FieldLists = {
    stamp,
    sets: setRows.map((r) => ({
      language: r.language,
      setName: r.set_name,
      words: termWords(r.set_name)
    })),
    rarities,
    codes
  }
  byGame.set(game, lists)
  return lists
}

/** Whether `run` is a contiguous word-prefix match inside a set's name words. */
function runMatches(run: string[], name: string[]): boolean {
  for (let at = 0; at + run.length <= name.length; at++) {
    let ok = true
    for (let k = 0; k < run.length && ok; k++) {
      const w = run[k]
      const n = name[at + k]
      const last = k === run.length - 1
      ok = n === w || (last && w.length >= MIN_PREFIX_LENGTH && !/^\d+$/.test(w) && n.startsWith(w))
    }
    if (ok) return true
  }
  return false
}

const hasDigit = (w: string): boolean => /\d/.test(w)

/**
 * Reads set, rarity, set-code and card-number words out of a query. Null unless a field was found
 * and something besides one bare field constrains the search: a leftover name word, `termsConstrain`
 * (an approved term already matched), or a set code with a number.
 */
export function parseFields(
  db: SqlDb,
  scope: Scope,
  words: string[],
  termsConstrain = false
): FieldQuery | null {
  const game = scopeGame(db, scope)
  const lists = fieldLists(db, scope, game)
  const used = new Array<boolean>(words.length).fill(false)

  // The longest run of words that is a word-prefix of one or more set names.
  let sets: FieldQuery['sets'] = null
  let best = { start: -1, len: 0 }
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(MAX_SET_WORDS, words.length - i); n > best.len; n--) {
      const run = words.slice(i, i + n)
      if (lists.sets.some((s) => runMatches(run, s.words))) {
        best = { start: i, len: n }
        break
      }
    }
  }
  if (best.len > 0) {
    const run = words.slice(best.start, best.start + best.len)
    sets = lists.sets
      .filter((s) => runMatches(run, s.words))
      .map((s) => ({ language: s.language, setName: s.setName }))
    for (let k = 0; k < best.len; k++) used[best.start + k] = true
  }

  // Rarity runs, longest first; an abbreviation maps to its label's key.
  const abbreviations = RARITY_ABBREVIATIONS[game]
  const rarityLabels = new Set<string>()
  for (let i = 0; i < words.length;) {
    let took = 0
    if (!used[i]) {
      for (let n = Math.min(MAX_RARITY_WORDS, words.length - i); n >= 1 && !took; n--) {
        if (used.slice(i, i + n).some(Boolean)) continue
        const key = words.slice(i, i + n).join(' ')
        const abbr = n === 1 && abbreviations[key] ? termKey(abbreviations[key]) : null
        const labels = lists.rarities.get(key) ?? (abbr ? lists.rarities.get(abbr) : undefined)
        if (labels) {
          for (const l of labels) rarityLabels.add(l)
          took = n
        }
      }
    }
    if (took) for (let k = 0; k < took; k++) used[i + k] = true
    i += took || 1
  }

  let codePrefix: string | null = null
  let number: string | null = null
  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue
    const w = words[i]
    if (codePrefix === null && /^[a-z]{2,5}\d{0,3}$/.test(w) && lists.codes.has(w)) {
      codePrefix = w
      used[i] = true
    } else if (hasDigit(w)) {
      // A number is a run of digit-bearing words: "232", "tg03", "232 091".
      let j = i
      while (j < words.length && !used[j] && hasDigit(words[j])) j++
      if (number === null) {
        number = words.slice(i, j).join(' ')
        for (let k = i; k < j; k++) used[k] = true
      }
      i = j - 1
    }
  }

  const nameWords = words.filter((_, i) => !used[i])
  const found = sets !== null || rarityLabels.size > 0 || codePrefix !== null || number !== null
  // A set code with a number ("lor tg03") names a printing on its own.
  const standalone = termsConstrain || (codePrefix !== null && number !== null)
  if (!found || (nameWords.length === 0 && !standalone)) return null
  return {
    sets,
    rarities: rarityLabels.size > 0 ? [...rarityLabels] : null,
    codePrefix,
    number,
    nameWords
  }
}

/**
 * Printing ids whose card matches `fq.nameWords` (any card when empty) and that pass every field
 * constraint, newest set first, cut at `limit`.
 */
export function fieldPrintingIds(db: SqlDb, scope: Scope, fq: FieldQuery, limit: number): number[] {
  const conds: string[] = []
  const params: unknown[] = []
  const fts = buildFtsQuery(fq.nameWords.join(' '))
  if (fq.sets && fq.sets.length > 0) {
    conds.push(`(p.language, p.set_name) IN (VALUES ${fq.sets.map(() => '(?, ?)').join(', ')})`)
    for (const s of fq.sets) params.push(s.language, s.setName)
  }
  if (fq.rarities && fq.rarities.length > 0) {
    conds.push(`p.set_rarity IN (${fq.rarities.map(() => '?').join(',')})`)
    params.push(...fq.rarities)
  }
  if (fq.codePrefix) {
    conds.push(`(p.set_code LIKE ? OR p.set_code LIKE ? OR p.set_code LIKE ?)`)
    params.push(`${fq.codePrefix} %`, `${fq.codePrefix}-%`, `${fq.codePrefix}:%`)
  }
  if (fq.number) {
    conds.push(
      `' ' || lower(replace(replace(replace(p.set_code, '/', ' '), '-', ' '), ':', ' ')) || ' ' LIKE ?`
    )
    params.push(`% ${fq.number} %`)
  }
  return (
    db
      .prepare(
        `SELECT p.id FROM card_printings p
         ${fts ? 'JOIN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ?) f ON f.rowid = p.card_id' : ''}
         LEFT JOIN sets s ON s.game = p.game AND s.language = p.language AND s.set_name = p.set_name
         WHERE +p.game = ${scope.game} AND p.contributed = 0
           ${conds.length ? `AND ${conds.join(' AND ')}` : ''}
         ORDER BY s.tcg_date DESC, p.id LIMIT ?`
      )
      .all(...(fts ? [fts] : []), ...params, limit) as { id: number }[]
  ).map((r) => r.id)
}
