export const RULES_SCHEMA = 1

export interface YgoFormatRules {
  /** card id → copies allowed (0 Forbidden, 1 Limited, 2 Semi-Limited); absent = 3 */
  limits: Record<string, 0 | 1 | 2>
  /** card id → its release date in the region (YYYY-MM-DD), or null when none is known; only cards not out by builtAt */
  notReleased: Record<string, string | null>
}

export interface YgoRulesPack {
  schema: number
  game: 'ygo'
  /** YYYY-MM-DD */
  version: string
  builtAt: string
  sources: { name: string; fetchedAt: string }[]
  formats: { advanced: YgoFormatRules; ocg: YgoFormatRules }
}

export type RulesPack = YgoRulesPack

export type PackState =
  { state: 'ready'; pack: RulesPack } | { state: 'missing' } | { state: 'tooNew' }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function validRules(v: unknown): v is YgoFormatRules {
  if (!isObj(v) || !isObj(v.limits) || !isObj(v.notReleased)) return false
  for (const n of Object.values(v.limits)) if (n !== 0 && n !== 1 && n !== 2) return false
  for (const d of Object.values(v.notReleased))
    if (d !== null && typeof d !== 'string') return false
  return true
}

/** Malformed → missing; a schema newer than this app reads → tooNew. */
export function parseRulesPack(raw: unknown): PackState {
  if (!isObj(raw) || typeof raw.schema !== 'number') return { state: 'missing' }
  if (raw.schema > RULES_SCHEMA) return { state: 'tooNew' }
  if (raw.game !== 'ygo' || typeof raw.version !== 'string' || typeof raw.builtAt !== 'string')
    return { state: 'missing' }
  if (!Array.isArray(raw.sources) || !isObj(raw.formats)) return { state: 'missing' }
  if (!validRules(raw.formats.advanced) || !validRules(raw.formats.ocg)) return { state: 'missing' }
  return { state: 'ready', pack: raw as unknown as RulesPack }
}
