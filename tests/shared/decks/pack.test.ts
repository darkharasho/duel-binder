import { describe, expect, it } from 'vitest'
import { parseRulesPack } from '../../../src/shared/decks/pack'

const fmt = { limits: { 55144522: 0 }, notReleased: { 77777777: '2026-12-05' } }
const pack = {
  schema: 1,
  game: 'ygo',
  version: '2026-11-22',
  builtAt: '2026-11-22T03:00:00Z',
  sources: [{ name: 'x', fetchedAt: '2026-11-22T02:00:00Z' }],
  formats: { advanced: fmt, ocg: { limits: {}, notReleased: {} } }
}

describe('parseRulesPack', () => {
  it('reads bad input as missing', () => {
    expect(parseRulesPack(null)).toEqual({ state: 'missing' })
    expect(parseRulesPack('x')).toEqual({ state: 'missing' })
    expect(parseRulesPack({ schema: 1 })).toEqual({ state: 'missing' })
    const bad = {
      ...pack,
      formats: { ...pack.formats, advanced: { limits: { 1: 5 }, notReleased: {} } }
    }
    expect(parseRulesPack(bad)).toEqual({ state: 'missing' })
  })
  it('reads a newer schema as tooNew', () => {
    expect(parseRulesPack({ ...pack, schema: 2 })).toEqual({ state: 'tooNew' })
  })
  it('reads a good pack as ready', () => {
    const r = parseRulesPack(pack)
    expect(r.state).toBe('ready')
  })
})

describe('parseRulesPack pkm', () => {
  const pkm = {
    schema: 1,
    game: 'pkm',
    version: '2026-11-22',
    builtAt: '2026-11-22T03:00:00Z',
    sources: [{ name: 'x', fetchedAt: '2026-11-22T02:00:00Z' }],
    keys: [{ n: 'Ultra Ball', k: 'T', f: 0, l: 3 }],
    ids: { sv01: { '196': 0 } },
    formats: { standard: { banned: [] as number[] }, expanded: { banned: [] as number[] } }
  }
  it('parses a valid pkm pack', () => {
    const r = parseRulesPack(pkm)
    expect(r.state).toBe('ready')
    if (r.state === 'ready') expect(r.pack.game).toBe('pkm')
  })
  it('rejects a pkm pack whose ids are not grouped by set', () => {
    expect(parseRulesPack({ ...pkm, ids: { 'sv01-196': 0 } })).toEqual({ state: 'missing' })
  })
  it('rejects a pkm pack whose ids point past keys', () => {
    expect(parseRulesPack({ ...pkm, ids: { x: { '1': 5 } } })).toEqual({ state: 'missing' })
  })
  it('rejects a pkm key with a bad kind', () => {
    expect(parseRulesPack({ ...pkm, keys: [{ n: 'A', k: 'X', f: 0, l: 3 }] })).toEqual({
      state: 'missing'
    })
  })
  it('rejects a pkm banned index out of range', () => {
    const bad = { ...pkm, formats: { ...pkm.formats, expanded: { banned: [3] } } }
    expect(parseRulesPack(bad)).toEqual({ state: 'missing' })
  })
  it('a pkm pack of a newer schema is tooNew', () => {
    expect(parseRulesPack({ ...pkm, schema: 2 })).toEqual({ state: 'tooNew' })
  })
})

describe('parseRulesPack op', () => {
  const fmt = {
    banned: [{ card: 'OP03-040' }, { card: 'OP14-020', from: '2026-10-12' }],
    restricted: {} as Record<string, number>,
    bannedPairs: [{ leader: 'OP13-001', cards: ['EB05-001'], from: '2026-11-27' }]
  }
  const op = {
    schema: 1,
    game: 'op',
    version: '2026-11-22',
    builtAt: '2026-11-22T03:00:00Z',
    sources: [{ name: 'Bandai', fetchedAt: '2026-11-22' }],
    formats: {
      standard: { ...fmt, rotatedBlocks: [1], exempt: ['OP01-016'] },
      extra: fmt
    },
    setBlocks: {}
  }
  const withStandard = (s: Record<string, unknown>) => ({
    ...op,
    formats: { ...op.formats, standard: { ...op.formats.standard, ...s } }
  })
  it('parses a valid op pack', () => {
    const r = parseRulesPack(op)
    expect(r.state).toBe('ready')
    if (r.state === 'ready') expect(r.pack.game).toBe('op')
  })
  it('rejects an op pack with a bad date', () => {
    const bad = withStandard({
      bannedPairs: [{ leader: 'OP13-001', cards: ['EB05-001'], from: '27 Nov' }]
    })
    expect(parseRulesPack(bad)).toEqual({ state: 'missing' })
    const badBan = withStandard({ banned: [{ card: 'OP14-020', from: '27 Nov' }] })
    expect(parseRulesPack(badBan)).toEqual({ state: 'missing' })
  })
  it('rejects an op pack with an impossible date', () => {
    for (const from of ['2026-13-45', '2026-02-30'])
      expect(parseRulesPack(withStandard({ banned: [{ card: 'OP14-020', from }] }))).toEqual({
        state: 'missing'
      })
  })
  it("rejects an op pack whose restricted count isn't 0–3", () => {
    expect(parseRulesPack(withStandard({ restricted: { 'OP01-016': 5 } }))).toEqual({
      state: 'missing'
    })
  })
  it('rejects an op pack missing standard.rotatedBlocks', () => {
    const { rotatedBlocks: _r, ...std } = op.formats.standard
    expect(parseRulesPack({ ...op, formats: { ...op.formats, standard: std } })).toEqual({
      state: 'missing'
    })
  })
  it("rejects an op pack whose card numbers aren't non-empty strings", () => {
    expect(parseRulesPack(withStandard({ banned: [{ card: '' }] }))).toEqual({ state: 'missing' })
    expect(parseRulesPack(withStandard({ exempt: [16] }))).toEqual({ state: 'missing' })
    expect(
      parseRulesPack(withStandard({ bannedPairs: [{ leader: 'OP13-001', cards: [''] }] }))
    ).toEqual({ state: 'missing' })
    expect(
      parseRulesPack(withStandard({ bannedPairs: [{ leader: 7, cards: ['EB05-001'] }] }))
    ).toEqual({ state: 'missing' })
  })
})
