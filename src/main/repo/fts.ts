/** Turns free text into a safe FTS5 prefix query, or null when nothing searchable remains. */
export function buildFtsQuery(q: string): string | null {
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' ') : null
}
