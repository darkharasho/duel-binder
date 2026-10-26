import { NAME_MIN_MARGIN, NAME_MIN_SCORE } from './thresholds'

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** The name closest to the OCR text, or null when it's too far off or too close to a runner-up. */
export function bestNameMatch(
  text: string,
  names: { id: number; name: string }[]
): { id: number; score: number } | null {
  const t = normalizeName(text)
  if (!t) return null
  let best: { id: number; score: number } | null = null
  let second = 0
  for (const n of names) {
    const m = normalizeName(n.name)
    const maxLen = Math.max(t.length, m.length)
    if (!maxLen) continue
    const score = 1 - levenshtein(t, m) / maxLen
    if (!best || score > best.score) {
      if (best) second = best.score
      best = { id: n.id, score }
    } else if (score > second) second = score
  }
  if (!best || best.score < NAME_MIN_SCORE || best.score - second < NAME_MIN_MARGIN) return null
  return best
}
