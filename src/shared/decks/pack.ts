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
  /** TCGdex English card id "sv01-196" → ids.sv01["196"] = index into keys; grouped by set to keep the pack small */
  ids: Record<string, Record<string, number>>
  formats: { standard: { banned: number[] }; expanded: { banned: number[] } }
}

/** Splits a TCGdex card id at its last dash: "sv01-196" → ["sv01", "196"]; "tk-xy-latia-1" → ["tk-xy-latia", "1"]. */
export function splitCardId(id: string): [string, string] {
  const i = id.lastIndexOf('-')
  return i < 0 ? ['', id] : [id.slice(0, i), id.slice(i + 1)]
}

/** The key index a pack holds for a TCGdex card id, if any. */
export function packKeyOfId(pack: PkmRulesPack, id: string): number | undefined {
  const [set, local] = splitCardId(id)
  const group = Object.prototype.hasOwnProperty.call(pack.ids, set) ? pack.ids[set] : undefined
  return group && Object.prototype.hasOwnProperty.call(group, local) ? group[local] : undefined
}

export interface OpBan {
  /** Card number, "OP03-040" */
  card: string
  /** YYYY-MM-DD the ban starts; absent = in force */
  from?: string
}

export interface OpPair {
  /** The Leader's card number */
  leader: string
  /** Card numbers that can't be used with this Leader */
  cards: string[]
  /** YYYY-MM-DD the pair starts; absent = in force */
  from?: string
}

export interface OpFormatRules {
  banned: OpBan[]
  /** card number → copies allowed */
  restricted: Record<string, number>
  bannedPairs: OpPair[]
}

export interface OpRulesPack {
  schema: number
  game: 'op'
  version: string
  builtAt: string
  sources: { name: string; fetchedAt: string }[]
  formats: {
    standard: OpFormatRules & { rotatedBlocks: number[]; exempt: string[] }
    extra: OpFormatRules
  }
  /** Number prefix ("OP01") → block, for cards the catalog has no block icon for */
  setBlocks: Record<string, number>
  /**
   * Card numbers whose text lets a deck hold any number of them: no 4-copy limit (bans and
   * restrictions still apply). Absent in packs built before it existed; read as [].
   */
  unlimited?: string[]
}

export type RulesPack = YgoRulesPack | PkmRulesPack | OpRulesPack

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
  for (const set of Object.values(raw.ids)) {
    if (!isObj(set)) return false
    for (const i of Object.values(set)) if (!inRange(i)) return false
  }
  for (const f of ['standard', 'expanded']) {
    const fm = raw.formats[f]
    if (!isObj(fm) || !Array.isArray(fm.banned) || !fm.banned.every(inRange)) return false
  }
  return true
}

const isCardNo = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function isDay(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

const validFrom = (o: Record<string, unknown>): boolean => o.from === undefined || isDay(o.from)

function validOpRules(v: unknown): v is OpFormatRules {
  if (!isObj(v) || !Array.isArray(v.banned) || !isObj(v.restricted)) return false
  if (!Array.isArray(v.bannedPairs)) return false
  for (const b of v.banned) if (!isObj(b) || !isCardNo(b.card) || !validFrom(b)) return false
  for (const [card, n] of Object.entries(v.restricted))
    if (!isCardNo(card) || !Number.isInteger(n) || (n as number) < 0 || (n as number) > 3)
      return false
  for (const p of v.bannedPairs) {
    if (!isObj(p) || !isCardNo(p.leader) || !validFrom(p)) return false
    if (!Array.isArray(p.cards) || p.cards.length === 0 || !p.cards.every(isCardNo)) return false
  }
  return true
}

function validOp(raw: Record<string, unknown>): boolean {
  const fm = raw.formats
  if (!isObj(fm) || !validOpRules(fm.standard) || !validOpRules(fm.extra)) return false
  const std = fm.standard as unknown as Record<string, unknown>
  if (!Array.isArray(std.rotatedBlocks) || !std.rotatedBlocks.every(Number.isInteger)) return false
  if (!Array.isArray(std.exempt) || !std.exempt.every(isCardNo)) return false
  if (!isObj(raw.setBlocks)) return false
  for (const b of Object.values(raw.setBlocks)) if (!Number.isInteger(b)) return false
  if (
    raw.unlimited !== undefined &&
    (!Array.isArray(raw.unlimited) || !raw.unlimited.every(isCardNo))
  )
    return false
  return true
}

/** Malformed → missing; a schema newer than this app reads → tooNew. */
export function parseRulesPack(raw: unknown): PackState {
  if (!isObj(raw) || typeof raw.schema !== 'number') return { state: 'missing' }
  if (raw.schema > RULES_SCHEMA) return { state: 'tooNew' }
  if (
    (raw.game !== 'ygo' && raw.game !== 'pkm' && raw.game !== 'op') ||
    typeof raw.version !== 'string' ||
    typeof raw.builtAt !== 'string'
  )
    return { state: 'missing' }
  if (!Array.isArray(raw.sources) || !isObj(raw.formats)) return { state: 'missing' }
  if (raw.game === 'pkm')
    return validPkm(raw)
      ? { state: 'ready', pack: raw as unknown as PkmRulesPack }
      : { state: 'missing' }
  if (raw.game === 'op')
    return validOp(raw)
      ? { state: 'ready', pack: raw as unknown as OpRulesPack }
      : { state: 'missing' }
  const fm = raw.formats
  if (!validRules(fm.advanced) || !validRules(fm.ocg)) return { state: 'missing' }
  return { state: 'ready', pack: raw as unknown as RulesPack }
}
