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

export const PKM_FLAG = { basic: 1, aceSpec: 2, radiant: 4, basicEnergy: 8 } as const
export const PKM_LEGAL = { standard: 1, expanded: 2 } as const

export interface PkmKey {
  /** English name as TCGdex prints it */
  n: string
  k: 'P' | 'T' | 'E'
  /** PKM_FLAG bits */
  f: number
  /** PKM_LEGAL bits */
  l: number
}

export interface PkmRulesPack {
  schema: number
  game: 'pkm'
  version: string
  builtAt: string
  sources: { name: string; fetchedAt: string }[]
  keys: PkmKey[]
  /** TCGdex English card id ("sv01-196") → index into keys */
  ids: Record<string, number>
  formats: { standard: { banned: number[] }; expanded: { banned: number[] } }
}

export type RulesPack = YgoRulesPack | PkmRulesPack

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

function validPkm(raw: Record<string, unknown>): boolean {
  if (!Array.isArray(raw.keys) || !isObj(raw.ids) || !isObj(raw.formats)) return false
  for (const k of raw.keys) {
    if (!isObj(k) || typeof k.n !== 'string') return false
    if (k.k !== 'P' && k.k !== 'T' && k.k !== 'E') return false
    if (!Number.isInteger(k.f) || !Number.isInteger(k.l)) return false
  }
  const max = raw.keys.length
  const inRange = (i: unknown): boolean =>
    Number.isInteger(i) && (i as number) >= 0 && (i as number) < max
  for (const i of Object.values(raw.ids)) if (!inRange(i)) return false
  for (const f of ['standard', 'expanded']) {
    const fm = raw.formats[f]
    if (!isObj(fm) || !Array.isArray(fm.banned) || !fm.banned.every(inRange)) return false
  }
  return true
}

/** Malformed → missing; a schema newer than this app reads → tooNew. */
export function parseRulesPack(raw: unknown): PackState {
  if (!isObj(raw) || typeof raw.schema !== 'number') return { state: 'missing' }
  if (raw.schema > RULES_SCHEMA) return { state: 'tooNew' }
  if (
    (raw.game !== 'ygo' && raw.game !== 'pkm') ||
    typeof raw.version !== 'string' ||
    typeof raw.builtAt !== 'string'
  )
    return { state: 'missing' }
  if (!Array.isArray(raw.sources) || !isObj(raw.formats)) return { state: 'missing' }
  if (raw.game === 'pkm')
    return validPkm(raw)
      ? { state: 'ready', pack: raw as unknown as PkmRulesPack }
      : { state: 'missing' }
  const fm = raw.formats
  if (!validRules(fm.advanced) || !validRules(fm.ocg)) return { state: 'missing' }
  return { state: 'ready', pack: raw as unknown as RulesPack }
}
