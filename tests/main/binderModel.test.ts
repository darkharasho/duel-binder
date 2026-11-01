import { describe, expect, it } from 'vitest'
import { draftProblem, rulesEditable, type BinderDraft } from '../../src/shared/binders'

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
    const d = draft({ rules: { version: 1, rules: [{ field: 'artist', values: ['Mitsuhiro Arita'] }] } })
    expect(draftProblem(d, 'ygo')).not.toBeNull()
    expect(draftProblem(d, 'pkm')).toBeNull()
  })
  it('rejects empty and over-long names', () => {
    expect(draftProblem(draft({ name: '' }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ name: '   ' }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ name: 'x'.repeat(81) }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ name: 'x'.repeat(80) }), 'ygo')).toBeNull()
  })
  it('rejects too many rules and values', () => {
    const rule = { field: 'race' as const, values: ['Dragon'] }
    expect(draftProblem(draft({ rules: { version: 1, rules: Array(9).fill(rule) } }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ rules: { version: 1, rules: Array(8).fill(rule) } }), 'ygo')).toBeNull()
    const many = (n: number) => ({ version: 1, rules: [{ field: 'race' as const, values: Array.from({ length: n }, (_, i) => `v${i}`) }] })
    expect(draftProblem(draft({ rules: many(21) }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ rules: many(20) }), 'ygo')).toBeNull()
  })
  it('rejects an unknown language', () => {
    expect(draftProblem(draft({ languages: ['xx' as never] }), 'ygo')).not.toBeNull()
  })
  it('rejects non-objects and malformed rules', () => {
    expect(draftProblem(null, 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ rules: { version: 2, rules: [] } }), 'ygo')).not.toBeNull()
    expect(draftProblem(draft({ rules: { version: 1, rules: [{ field: 'race', values: [] }] } }), 'ygo')).not.toBeNull()
  })
})

describe('rulesEditable', () => {
  it('parses current rules', () => {
    const raw = JSON.stringify({ version: 1, rules: [{ field: 'rarity', values: ['Ultra Rare'] }] })
    expect(rulesEditable(raw)?.rules).toHaveLength(1)
  })
  it('returns null for version 2, an unknown field and bad JSON', () => {
    expect(rulesEditable(JSON.stringify({ version: 2, rules: [] }))).toBeNull()
    expect(rulesEditable(JSON.stringify({ version: 1, rules: [{ field: 'bogus', values: ['a'] }] }))).toBeNull()
    expect(rulesEditable('{nope')).toBeNull()
  })
})
