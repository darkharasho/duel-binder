import { NAME_MIN_MARGIN, NAME_MIN_SCORE } from './thresholds'

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Two reusable rows: a name lookup runs this against every card name in the catalog.
let prevRow = new Int32Array(64)
let curRow = new Int32Array(64)

/** The edit distance, or Infinity as soon as it's sure to be over `limit`. */
function levenshtein(a: string, b: string, limit = Infinity): number {
  if (prevRow.length <= b.length) {
    prevRow = new Int32Array(b.length + 1)
    curRow = new Int32Array(b.length + 1)
  }
  let prev = prevRow
  let cur = curRow
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = i
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1)
      const del = prev[j] + 1
      const ins = cur[j - 1] + 1
      cur[j] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    // No row's smallest entry is ever below the last one's.
    if (rowMin > limit) return Infinity
    const t = prev
    prev = cur
    cur = t
  }
  return prev[b.length]
}

/** A card name, with its normalized form when worked out ahead of time. */
export interface NameEntry {
  id: number
  name: string
  norm?: string
}

/**
 * Scores below this can't change the answer: the best must reach NAME_MIN_SCORE, and then
 * anything this far below it can't be within NAME_MIN_MARGIN of it.
 */
const IRRELEVANT_BELOW = NAME_MIN_SCORE - NAME_MIN_MARGIN

/** The name closest to the OCR text, or null when it's too far off or too close to a runner-up. */
export function bestNameMatch(
  text: string,
  names: readonly NameEntry[]
): { id: number; score: number } | null {
  const t = normalizeName(text)
  if (!t) return null
  let best: { id: number; score: number } | null = null
  let second = 0
  for (const n of names) {
    const m = n.norm ?? normalizeName(n.name)
    const maxLen = Math.max(t.length, m.length)
    if (!maxLen) continue
    // The length difference alone caps the score. A name capped at or below the runner-up can't
    // become best or runner-up, and one capped below IRRELEVANT_BELOW can't change the answer.
    const cap = 1 - Math.abs(t.length - m.length) / maxLen
    if (cap < IRRELEVANT_BELOW || (best && cap <= second)) continue
    // Likewise, a distance past what either bound allows needn't be worked out to the end.
    const floor = best ? Math.max(IRRELEVANT_BELOW, second) : IRRELEVANT_BELOW
    const limit = Math.floor((1 - floor) * maxLen + 1e-9)
    const distance = levenshtein(t, m, limit)
    if (distance > limit) continue
    const score = 1 - distance / maxLen
    if (!best || score > best.score) {
      if (best) second = best.score
      best = { id: n.id, score }
    } else if (score > second) second = score
  }
  if (!best || best.score < NAME_MIN_SCORE || best.score - second < NAME_MIN_MARGIN) return null
  return best
}
