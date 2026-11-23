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
    ids: { 'sv01-196': 0 },
    formats: { standard: { banned: [] as number[] }, expanded: { banned: [] as number[] } }
  }
  it('parses a valid pkm pack', () => {
    const r = parseRulesPack(pkm)
    expect(r.state).toBe('ready')
    if (r.state === 'ready') expect(r.pack.game).toBe('pkm')
  })
  it('rejects a pkm pack whose ids point past keys', () => {
    expect(parseRulesPack({ ...pkm, ids: { x: 5 } })).toEqual({ state: 'missing' })
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
