import type { GameId } from './games/types'
import { LANGUAGES, type Language } from './languages'

/**
 * Rules a binder matching every rule saves as. One matching any rule saves as BINDER_RULES_ANY_VERSION,
 * so an app from before "any" refuses it (shows it, won't edit it) rather than reading it as "every".
 */
export const BINDER_RULES_VERSION = 1
export const BINDER_RULES_ANY_VERSION = 2
export const MAX_BINDER_MATCHES = 10_000 // qualifying printings
export const MAX_BINDERS = 50 // per owner and game
export const MAX_BINDER_EDITS = 2_000 // per binder
export const MAX_BINDER_NAME = 80
export const MAX_RULES = 8
export const MAX_RULE_VALUES = 20
/** The longest serialized `rules` the server stores, measured as `string.length` on both sides. */
export const MAX_BINDER_RULES_BYTES = 8192

export type RuleField =
  | 'name'
  | 'artist'
  | 'cardType'
  | 'frameType'
  | 'race'
  | 'category'
  | 'energyType'
  | 'stage'
  | 'attribute'
  | 'level'
  | 'archetype'
  | 'set'
  | 'rarity'
export type BinderRule =
  | { field: 'name'; op: 'is' | 'contains'; value: string }
  | { field: Exclude<RuleField, 'name'>; values: string[] }
export type BinderGoal = 'none' | 'card' | 'art' | 'printing'
/** Whether a printing must meet every rule or just one. */
export type RuleMatch = 'all' | 'any'
export type BinderSort = 'release' | 'set' | 'name' | 'type' | 'number' | 'price'
export const BINDER_SORTS: readonly BinderSort[] = [
  'release',
  'set',
  'name',
  'type',
  'number',
  'price'
]
export type SortDir = 'asc' | 'desc'
export interface BinderOrder {
  by: BinderSort
  dir: SortDir
}
export interface BinderRules {
  version: number
  rules: BinderRule[]
  /** Absent means 'all'. 'any' only with BINDER_RULES_ANY_VERSION. */
  match?: RuleMatch
  /**
   * How the binder's pages are ordered, on every device and for friends. Absent means the app's
   * default. A newer app's `by` this one doesn't know is kept as stored and shown in the default order.
   */
  order?: { by: string; dir: SortDir }
}

/** The rules as saved: the version follows `match`, and 'all' is left out. */
export function normalizeRules(rules: BinderRules): BinderRules {
  const any = rules.match === 'any' && rules.rules.length > 1
  return {
    version: any ? BINDER_RULES_ANY_VERSION : BINDER_RULES_VERSION,
    rules: rules.rules,
    ...(any && { match: 'any' as const }),
    ...(rules.order && { order: rules.order })
  }
}

/** What is wrong with the rules object around the rule list, or null. */
function rulesShapeProblem(rules: Record<string, unknown>): string | null {
  const { version, match, order } = rules
  if (version !== BINDER_RULES_VERSION && version !== BINDER_RULES_ANY_VERSION)
    return 'The binder rules are not valid.'
  if (!Array.isArray(rules.rules)) return 'The binder rules are not valid.'
  if (match !== undefined && match !== 'all' && match !== 'any')
    return 'Rules must match "all" or "any".'
  if ((match === 'any') !== (version === BINDER_RULES_ANY_VERSION))
    return 'The binder rules are not valid.'
  if (order !== undefined) {
    if (!isObj(order) || typeof order.by !== 'string' || !order.by || order.by.length > 32)
      return 'The binder order is not valid.'
    if (order.dir !== 'asc' && order.dir !== 'desc') return 'The binder order is not valid.'
  }
  return null
}
export interface BinderDraft {
  uid?: string
  name: string
  rules: BinderRules
  goal: BinderGoal
  languages: Language[]
  friendsVisible: boolean
}
export type BinderEditLevel = 'card' | 'art' | 'printing'
export interface BinderTarget {
  level: BinderEditLevel
  target: string // card_id, image_id or pkey as text
}
export type BinderEditAction = 'add' | 'remove'

export const RULE_FIELDS: Record<GameId, readonly RuleField[]> = {
  ygo: [
    'name',
    'cardType',
    'frameType',
    'race',
    'attribute',
    'level',
    'archetype',
    'set',
    'rarity'
  ],
  pkm: ['name', 'artist', 'category', 'energyType', 'stage', 'set', 'rarity'],
  op: ['name', 'set', 'rarity'],
  mtg: ['name', 'set', 'rarity']
}

export const GOALS: Record<GameId, readonly BinderGoal[]> = {
  ygo: ['none', 'card', 'art', 'printing'],
  pkm: ['none', 'card', 'printing'],
  op: ['none', 'card', 'printing'],
  mtg: ['none', 'card', 'printing']
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** What is wrong with one rule, or null. `fields` are the fields the caller allows. */
function ruleProblem(rule: unknown, fields: readonly RuleField[]): string | null {
  if (!isObj(rule) || typeof rule.field !== 'string') return 'Each rule needs a field.'
  if (!(fields as readonly string[]).includes(rule.field))
    return `Unknown rule field: ${rule.field}.`
  if (rule.field === 'name') {
    if (rule.op !== 'is' && rule.op !== 'contains') return 'A name rule must be "is" or "contains".'
    if (typeof rule.value !== 'string' || !rule.value.trim()) return 'A name rule needs a value.'
    return null
  }
  const { values } = rule
  if (!Array.isArray(values) || values.length === 0)
    return `The ${rule.field} rule needs at least one value.`
  if (values.length > MAX_RULE_VALUES) return `A rule can have at most ${MAX_RULE_VALUES} values.`
  if (values.some((v) => typeof v !== 'string' || !v.trim()))
    return `The ${rule.field} rule has an empty value.`
  return null
}

/** What's wrong with a binder draft for this game, or null when it is fine. */
export function draftProblem(draft: unknown, game: GameId): string | null {
  if (!isObj(draft)) return 'Binder is missing.'
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) return 'A binder needs a name.'
  if (name.length > MAX_BINDER_NAME)
    return `A binder name can be at most ${MAX_BINDER_NAME} characters.`
  if (!isObj(draft.rules)) return 'The binder rules are not valid.'
  const shape = rulesShapeProblem(draft.rules)
  if (shape) return shape
  const rules = draft.rules.rules as unknown[]
  if (rules.length > MAX_RULES) return `A binder can have at most ${MAX_RULES} rules.`
  for (const rule of rules) {
    const problem = ruleProblem(rule, RULE_FIELDS[game])
    if (problem) return problem
  }
  if (JSON.stringify(draft.rules).length > MAX_BINDER_RULES_BYTES)
    return 'These binder rules are too long.'
  if (!(GOALS[game] as readonly unknown[]).includes(draft.goal))
    return 'That goal is not available for this game.'
  if (!Array.isArray(draft.languages))
    return 'Languages must be a list (empty means every language).'
  const known = new Set<string>(LANGUAGES.map((l) => l.code))
  if (draft.languages.some((l) => typeof l !== 'string' || !known.has(l)))
    return 'Unknown language.'
  if (typeof draft.friendsVisible !== 'boolean') return 'friendsVisible must be true or false.'
  return null
}

const ALL_FIELDS: readonly RuleField[] = [...new Set([...RULE_FIELDS.ygo, ...RULE_FIELDS.pkm])]

/** Parse stored rules JSON; null when the version or a field is unknown (so the editor can refuse it). */
export function rulesEditable(raw: string): BinderRules | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(parsed) || rulesShapeProblem(parsed)) return null
  for (const rule of parsed.rules as unknown[]) if (ruleProblem(rule, ALL_FIELDS)) return null
  return parsed as unknown as BinderRules
}
