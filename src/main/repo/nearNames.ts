import type { SqlDb } from '../db/sql'

/** Most vocab terms read for one word: a big catalog (Magic) has many terms under two letters. */
const CANDIDATE_CAP = 3000

/** Lowercase, diacritics off: the way the cards_fts tokenizer (unicode61 remove_diacritics 2) stores a term. */
export function foldWord(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Damerau-Levenshtein distance (adjacent swaps count one), giving up above `limit`. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  const rows: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array<number>(b.length + 1).fill(0))
    rows[i][0] = i
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, rows[i - 2][j - 2] + 1)
      }
      rows[i][j] = d
    }
  }
  return rows[a.length][b.length]
}

/**
 * Name words close to a misspelt `word`, closest first. Empty for a word under 4 letters, for a
 * word the names already spell (or start), and when nothing is close. One range read of
 * cards_fts_vocab (terms sharing the first two letters, within two letters of its length), then
 * edit distance in code: up to 2 edits, 1 for a word under 6 letters.
 */
export function nearNameWords(db: SqlDb, word: string, max = 3): string[] {
  const w = foldWord(word)
  if (w.length < 4) return []
  const known = db
    .prepare('SELECT 1 FROM cards_fts_vocab WHERE term >= ? AND term < ? LIMIT 1')
    .get(w, `${w}￿`)
  if (known) return []
  const start = w.slice(0, 2)
  const terms = db
    .prepare(
      `SELECT term FROM cards_fts_vocab WHERE term >= ? AND term < ? AND length(term) BETWEEN ? AND ? LIMIT ${CANDIDATE_CAP}`
    )
    .all(start, `${start}￿`, w.length - 2, w.length + 2) as { term: string }[]
  const limit = w.length < 6 ? 1 : 2
  return terms
    .map((r) => ({ term: r.term, d: editDistance(w, r.term, limit) }))
    .filter((c) => c.d <= limit)
    .sort((a, b) => a.d - b.d || a.term.localeCompare(b.term))
    .slice(0, max)
    .map((c) => c.term)
}
