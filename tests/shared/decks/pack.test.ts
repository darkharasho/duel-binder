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
