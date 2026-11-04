/** Typed One Piece card numbers ("op5-119", "OP05119") read as the printed form "OP05-119". */

const squash = (text: string): string => text.toUpperCase().replace(/\s+/g, '')

export function normalizeOpNumber(text: string): string | null {
  const t = squash(text)
  const m = /^([A-Z]{1,3})(\d{1,2})?-(\d{3})$/.exec(t) ?? /^([A-Z]{1,3})(\d{2})?(\d{3})$/.exec(t)
  if (!m) return null
  return `${m[1]}${m[2] === undefined ? '' : m[2].padStart(2, '0')}-${m[3]}`
}

/**
 * The set codes ("OP10-") a half-typed number could be heading for: nothing once there is a dash
 * or the three number digits.
 */
export function prefixSuggestions(typed: string, prefixes: readonly string[], max = 8): string[] {
  const t = squash(typed)
  if (t === '' || t.includes('-') || /\d{3}$/.test(t)) return []
  return prefixes
    .filter((p) => p.startsWith(t))
    .slice(0, max)
    .map((p) => `${p}-`)
}
