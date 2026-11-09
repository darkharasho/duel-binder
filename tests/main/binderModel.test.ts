import { describe, expect, it } from 'vitest'
import type { BinderRules } from '../../src/shared/binders'
import {
  MAX_BINDER_RULES_BYTES,
  draftProblem,
  normalizeRules,
  rulesEditable,
  type BinderDraft
} from '../../src/shared/binders'

const draft = (over: Partial<BinderDraft> = {}): BinderDraft => ({
  name: 'Blue-Eyes',
  rules: { version: 1, rules: [{ field: 'name', op: 'contains', value: 'Blue-Eyes' }] },
  goal: 'card',
  languages: ['en'],
  friendsVisible: false,
  ...over
})

describe('draftProblem', () => {
  it('accepts a Blue-Eyes draft', () => {
    expect(draftProblem(draft(), 'ygo')).toBeNull()
  })
  it('accepts empty languages (every language)', () => {
    expect(draftProblem(draft({ languages: [] }), 'ygo')).toBeNull()
  })
  it('rejects the art goal for pkm', () => {
    expect(draftProblem(draft({ goal: 'art' }), 'pkm')).not.toBeNull()
    expect(draftProblem(draft({ goal: 'art' }), 'ygo')).toBeNull()
  })
  it('rejects a field the game does not have', () => {
    const d = draft({
      rules: { version: 1, rules: [{ field: 'artist', values: ['Mitsuhiro Arita'] }] }
    })
    expect(draftProblem(d, 'ygo')).not.toBeNull()
    expect(draftProblem(d, 'pkm')).toBeNull()
  })
  it('rejects rules that serialize past what the server stores', () => {
    const sized = (length: number): BinderDraft['rules'] => {
      const rules = {
        version: 1,
        rules: [{ field: 'name' as const, op: 'is' as const, value: '' }]
      }
      rules.rules[0].value = 'x'.repeat(length - JSON.stringify(rules).length)
      return rules
    }
    expect(JSON.stringify(sized(MAX_BINDER_RULES_BYTES))).toHaveLength(8192)
    expect(draftProblem(draft({ rules: sized(MAX_BINDER_RULES_BYTES) }), 'ygo')).toBeNull()
    expect(draftProblem(draft({ rules: sized(MAX_BINDER_RULES_BYTES + 1) }), 'ygo')).not.toBeNull()
  })
  it('rejects empty and over-long names', () => {
    expect(draftProblem(draft({ name: '' }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ name: '   ' }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ name: 'x'.repeat(81) }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ name: 'x'.repeat(80) }), 'ygo')).toBeNull()
  })
  it('rejects too many rules and values', () => {
    const rule = { field: 'race' as const, values: ['Dragon'] }
    expect(
      draftProblem(draft({ rules: { version: 1, rules: Array(9).fill(rule) } }), 'ygo')
    ).not.toBeNull()
    expect(
      draftProblem(draft({ rules: { version: 1, rules: Array(8).fill(rule) } }), 'ygo')
    ).toBeNull()
    const many = (n: number): BinderRules => ({
      version: 1,
      rules: [{ field: 'race' as const, values: Array.from({ length: n }, (_, i) => `v${i}`) }]
    })
    expect(draftProblem(draft({ rules: many(21) }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ rules: many(20) }), 'ygo')).toBeNull()
  })
  it('rejects an unknown language', () => {
    expect(draftProblem(draft({ languages: ['xx' as never] }), 'ygo')).not.toBeNull()
  })
  it('rejects non-objects and malformed rules', () => {
    expect(draftProblem(null, 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ rules: { version: 2, rules: [] } }), 'ygo')).not.toBeNull()
    expect(
      draftProblem(draft({ rules: { version: 1, rules: [{ field: 'race', values: [] }] } }), 'ygo')
    ).not.toBeNull()
  })
})

describe('rulesEditable', () => {
  it('parses current rules', () => {
    const raw = JSON.stringify({ version: 1, rules: [{ field: 'rarity', values: ['Ultra Rare'] }] })
    expect(rulesEditable(raw)?.rules).toHaveLength(1)
  })
  it('returns null for version 3, an unknown field and bad JSON', () => {
    expect(rulesEditable(JSON.stringify({ version: 3, rules: [] }))).toBeNull()
    expect(rulesEditable(JSON.stringify({ version: 2, rules: [] }))).toBeNull()
    expect(
      rulesEditable(JSON.stringify({ version: 1, rules: [{ field: 'bogus', values: ['a'] }] }))
    ).toBeNull()
    expect(rulesEditable('{nope')).toBeNull()
  })
})

describe('matching any rule, and the saved order', () => {
  const two = [
    { field: 'name' as const, op: 'is' as const, value: 'Dark Magician' },
    { field: 'rarity' as const, values: ['Secret Rare'] }
  ]
  it('saves "any" as version 2, so an older app refuses rather than misreads it', () => {
    expect(normalizeRules({ version: 1, rules: two, match: 'any' })).toEqual({
      version: 2,
      rules: two,
      match: 'any'
    })
    expect(normalizeRules({ version: 2, rules: two, match: 'all' })).toEqual({
      version: 1,
      rules: two
    })
    // One rule matches the same either way.
    expect(normalizeRules({ version: 1, rules: two.slice(0, 1), match: 'any' })).toEqual({
      version: 1,
      rules: two.slice(0, 1)
    })
  })
  it('accepts any and an order, and refuses a mismatched version or a bad order', () => {
    const any = normalizeRules({
      version: 1,
      rules: two,
      match: 'any',
      order: { by: 'set', dir: 'asc' }
    })
    expect(draftProblem(draft({ rules: any }), 'ygo')).toBeNull()
    expect(rulesEditable(JSON.stringify(any))).toEqual(any)
    expect(
      draftProblem(draft({ rules: { version: 1, rules: two, match: 'any' } }), 'ygo')
    ).not.toBeNull()
    expect(
      draftProblem(draft({ rules: { version: 1, rules: two, match: 'most' as never } }), 'ygo')
    ).not.toBeNull()
    expect(
      draftProblem(
        draft({ rules: { version: 1, rules: two, order: { by: 'set', dir: 'up' as never } } }),
        'ygo'
      )
    ).not.toBeNull()
  })
  it("keeps a newer app's order it doesn't know", () => {
    const raw = { version: 1, rules: two, order: { by: 'mood', dir: 'asc' as const } }
    expect(draftProblem(draft({ rules: raw }), 'ygo')).toBeNull()
    expect(rulesEditable(JSON.stringify(raw))?.order).toEqual(raw.order)
  })
})
