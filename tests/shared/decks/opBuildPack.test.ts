import { describe, expect, it } from 'vitest'
import { parseRulesPack } from '../../../src/shared/decks/pack'
import { buildOpPack, type OpRulesFile } from '../../../src/shared/decks/onepiece/buildPack'
import shipped from '../../../src/shared/decks/rules/onepiece.json'

const empty = { banned: [], restricted: {}, bannedPairs: [] }
const file: OpRulesFile = {
  asOf: '2026-11-22',
  source: 'https://en.onepiece-cardgame.com/rules/',
  formats: { standard: { ...empty, rotatedBlocks: [1], exempt: [] }, extra: empty },
  setBlocks: {}
}

describe('buildOpPack', () => {
  it('version is asOf, builtAt is the run time', () => {
    const p = buildOpPack(file, new Date('2026-11-23T03:00:00Z'))
    expect(p.game).toBe('op')
    expect(p.version).toBe('2026-11-22')
    expect(p.builtAt).toBe('2026-11-23T03:00:00.000Z')
    expect(p.sources).toEqual([{ name: 'Bandai', fetchedAt: '2026-11-22' }])
    expect(parseRulesPack(p).state).toBe('ready')
  })
  it('throws when the file is malformed', () => {
    const bad = { ...file, formats: { ...file.formats, extra: { ...empty, restricted: { x: 9 } } } }
    expect(() => buildOpPack(bad, new Date())).toThrow()
  })
  it('the shipped onepiece.json builds', () => {
    expect(() => buildOpPack(shipped as OpRulesFile, new Date())).not.toThrow()
  })
  it('the shipped file exempts block icon X cards, which the catalog reads as no block', () => {
    // Bandai prints Super Parallel Rare numbers from April 2026 with block icon "X" (always in
    // Standard); the card list parser reads that as null, so they must be exempt, not unknown.
    const exempt = (shipped as OpRulesFile).formats.standard.exempt
    expect(exempt).toEqual(expect.arrayContaining(['OP18-031', 'OP18-065', 'OP17-118']))
  })
})
