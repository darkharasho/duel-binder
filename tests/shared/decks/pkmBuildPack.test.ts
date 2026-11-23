import { describe, expect, it } from 'vitest'
import {
  buildPkmPack,
  cardKeyOf,
  type PkmManual,
  type PkmPackCard
} from '../../../src/shared/decks/pokemon/buildPack'
import {
  PKM_FLAG,
  PKM_LEGAL,
  packKeyOfId,
  parseRulesPack,
  splitCardId
} from '../../../src/shared/decks/pack'

const now = new Date('2026-11-22T03:00:00Z')
const none: PkmManual = { banned: { standard: [], expanded: [] }, override: {} }
const c = (id: string, name: string, o: Partial<PkmPackCard> = {}): PkmPackCard => ({
  id,
  name,
  category: 'Pokemon',
  ...o
})
const build = (cards: PkmPackCard[], m: PkmManual = none) => buildPkmPack(cards, m, now, 0)

describe('buildPkmPack', () => {
  it('reprints share a key', () => {
    const p = build([
      c('a-1', 'Ultra Ball', { category: 'Trainer', legal: { standard: false, expanded: true } }),
      c('b-2', 'Ultra Ball', { category: 'Trainer', legal: { standard: true } })
    ])
    expect(p.keys).toHaveLength(1)
    expect(p.keys[0].l).toBe(3)
    expect(packKeyOfId(p, 'a-1')!).toBe(0)
    expect(packKeyOfId(p, 'b-2')!).toBe(0)
  })
  it('different attacks are different keys', () => {
    const p = build([
      c('a-1', 'Pikachu', { attacks: [{ name: 'Gnaw' }] }),
      c('a-2', 'Pikachu', { attacks: [{ name: 'Thunder' }] })
    ])
    expect(p.keys.map((k) => k.n)).toEqual(['Pikachu', 'Pikachu'])
    expect(
      cardKeyOf(
        c('x', 'Pikachu', { attacks: [{ name: 'B' }, { name: 'a' }], abilities: [{ name: 'Z' }] })
      )
    ).toBe('pikachu|a,b|z')
  })
  it('flags', () => {
    const p = build([
      c('1', 'A', { stage: 'Basic' }),
      c('2', 'B', { category: 'Trainer', rarity: 'ACE SPEC Rare' }),
      c('3', 'C', { category: 'Trainer', rarity: 'Rare ACE' }),
      c('4', 'Radiant Greninja'),
      c('5', 'Fire Energy', { category: 'Energy', energyType: 'Normal' }),
      c('6', 'Double Turbo', { category: 'Energy', energyType: 'Special' })
    ])
    const f = (id: string) => p.keys[packKeyOfId(p, id)!].f
    expect(f('1')).toBe(PKM_FLAG.basic)
    expect(f('2')).toBe(PKM_FLAG.aceSpec)
    expect(f('3')).toBe(PKM_FLAG.aceSpec)
    expect(f('4')).toBe(PKM_FLAG.radiant)
    expect(f('5')).toBe(PKM_FLAG.basicEnergy)
    expect(f('6')).toBe(0)
  })
  it('kind', () => {
    const p = build([
      c('1', 'A'),
      c('2', 'B', { category: 'Trainer' }),
      c('3', 'C', { category: 'Energy' })
    ])
    expect(p.keys.map((k) => k.k)).toEqual(['P', 'T', 'E'])
  })
  it('a banned id bans its whole key', () => {
    const p = build(
      [
        c('sm8-90', 'Unown', { attacks: [{ name: 'Hidden' }] }),
        c('x-1', 'Unown', { attacks: [{ name: 'Other' }] })
      ],
      { ...none, banned: { standard: [], expanded: ['sm8-90'] } }
    )
    expect(p.formats.expanded.banned).toEqual([packKeyOfId(p, 'sm8-90')!])
    expect(p.formats.expanded.banned).not.toContain(packKeyOfId(p, 'x-1')!)
    expect(p.formats.standard.banned).toEqual([])
  })
  it('override wins over TCGdex', () => {
    const p = build([c('sv01-196', 'X', { legal: { standard: false } })], {
      ...none,
      override: { 'sv01-196': { standard: true } }
    })
    expect(p.keys[0].l & PKM_LEGAL.standard).toBe(PKM_LEGAL.standard)
  })
  it('throws on a manual id not in the cards', () => {
    expect(() =>
      build([c('a', 'A')], { ...none, banned: { standard: ['zz-9'], expanded: [] } })
    ).toThrow(/zz-9/)
  })
  it('throws below the card floor', () => {
    const cards = Array.from({ length: 10 }, (_, i) => c(`a-${i}`, `N${i}`))
    expect(() => buildPkmPack(cards, none, now)).toThrow()
    expect(buildPkmPack(cards, none, now, 0).keys).toHaveLength(10)
  })
  it('version and builtAt, and parses', () => {
    const p = build([c('a', 'A')])
    expect(p.version).toBe('2026-11-22')
    expect(p.builtAt).toBe(now.toISOString())
    expect(p.sources).toEqual([{ name: 'TCGdex', fetchedAt: now.toISOString() }])
    expect(parseRulesPack(p).state).toBe('ready')
  })
  it('keeps basic and special Energy of the same name apart', () => {
    const p = build([
      c('1', 'Darkness Energy', { category: 'Energy', energyType: 'Normal' }),
      c('2', 'Darkness Energy', { category: 'Energy', energyType: 'Special' })
    ])
    expect(p.keys).toHaveLength(2)
    expect(p.keys[packKeyOfId(p, '1')!].f).toBe(PKM_FLAG.basicEnergy)
    expect(p.keys[packKeyOfId(p, '2')!].f).toBe(0)
  })
  it('an override with standard false clears the bit', () => {
    const p = build([c('a-1', 'X', { legal: { standard: true } })], {
      ...none,
      override: { 'a-1': { standard: false } }
    })
    expect(p.keys[0].l & PKM_LEGAL.standard).toBe(0)
  })
  it('throws on an override id not in the cards', () => {
    expect(() =>
      build([c('a', 'A')], { ...none, override: { 'zz-7': { standard: true } } })
    ).toThrow(/zz-7/)
  })
})

describe('ids grouped by set', () => {
  it('splits at the last dash, so set ids with dashes work', () => {
    expect(splitCardId('sv01-196')).toEqual(['sv01', '196'])
    expect(splitCardId('tk-xy-latia-1')).toEqual(['tk-xy-latia', '1'])
    expect(splitCardId('1')).toEqual(['', '1'])
  })
  it('nests ids by set and finds them back', () => {
    const p = buildPkmPack([c('tk-xy-latia-1', 'Bagon'), c('sv01-2', 'Pikachu')], none, now, 0)
    expect(Object.keys(p.ids).sort()).toEqual(['sv01', 'tk-xy-latia'])
    expect(packKeyOfId(p, 'tk-xy-latia-1')).toBe(0)
    expect(packKeyOfId(p, 'sv01-9')).toBeUndefined()
    expect(packKeyOfId(p, 'constructor-1')).toBeUndefined()
  })
})
