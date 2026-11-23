import { describe, expect, it } from 'vitest'
import { DECK_FORMATS, decksAvailable, defaultSection } from '../../../src/shared/decks/formats'
import type { MtgRulesPack } from '../../../src/shared/decks/pack'
import type { DeckCard } from '../../../src/shared/decks/types'

const c = (frameType: string): DeckCard => ({
  id: 1,
  name: 'Card',
  type: 'Monster',
  frameType,
  imageId: null,
  owned: 0,
  price: null,
  regionPrice: null,
  sourceId: null,
  code: null,
  opNumber: null,
  opCardType: null,
  opColors: [],
  opCost: null,
  opBlock: null,
  mtgName: null,
  mtgTypeLine: null,
  mtgColorIdentity: [],
  mtgManaValue: null,
  mtgLayout: null
})

describe('defaultSection', () => {
  it('puts every Extra Deck frame in Extra', () => {
    for (const f of [
      'fusion',
      'synchro',
      'xyz',
      'link',
      'fusion_pendulum',
      'synchro_pendulum',
      'xyz_pendulum'
    ])
      expect(defaultSection('ygo', c(f))).toBe('extra')
  })
  it('puts everything else, and an unknown card, in Main', () => {
    for (const f of ['effect', 'normal', 'ritual', 'effect_pendulum', 'spell', 'trap', 'token'])
      expect(defaultSection('ygo', c(f))).toBe('main')
    expect(defaultSection('ygo', undefined)).toBe('main')
  })
})

describe('pkm formats', () => {
  it('has Standard and Expanded with one 60-card section', () => {
    expect(DECK_FORMATS.pkm.map((f) => f.id)).toEqual(['standard', 'expanded'])
    for (const f of DECK_FORMATS.pkm)
      expect(f.sections).toEqual([{ id: 'main', label: 'Deck', min: 60, max: 60 }])
    expect(decksAvailable('pkm')).toBe(true)
  })
})

describe('op formats', () => {
  it('has Standard and Extra Regulation with a Leader and a 50-card Deck, in that order', () => {
    expect(DECK_FORMATS.op.map((f) => [f.id, f.label, f.priceRegion])).toEqual([
      ['standard', 'Standard', 'en'],
      ['extra', 'Extra Regulation', 'en']
    ])
    for (const f of DECK_FORMATS.op)
      expect(f.sections).toEqual([
        { id: 'leader', label: 'Leader', min: 1, max: 1 },
        { id: 'main', label: 'Deck', min: 50, max: 50 }
      ])
    expect(decksAvailable('op')).toBe(true)
  })
  it('puts a Leader in Leader and a Character in the Deck', () => {
    expect(defaultSection('op', { frameType: 'op', opCardType: 'Leader' })).toBe('leader')
    expect(defaultSection('op', { frameType: 'op', opCardType: 'Character' })).toBe('main')
  })
})

describe('mtg formats', () => {
  it('has the seven formats in order with their sections', () => {
    expect(DECK_FORMATS.mtg.map((f) => f.id)).toEqual([
      'standard',
      'pioneer',
      'modern',
      'legacy',
      'vintage',
      'pauper',
      'commander'
    ])
    const modern = DECK_FORMATS.mtg.find((f) => f.id === 'modern')!
    expect(modern.sections).toEqual([
      { id: 'main', label: 'Main', min: 60, max: Infinity },
      { id: 'side', label: 'Sideboard', min: 0, max: 15 }
    ])
    const cmd = DECK_FORMATS.mtg.find((f) => f.id === 'commander')!
    expect(cmd.sections.map((s) => [s.id, s.min, s.max])).toEqual([
      ['commander', 1, 2],
      ['main', 98, 99]
    ])
    expect(DECK_FORMATS.mtg.every((f) => f.priceRegion === 'en')).toBe(true)
  })
  it('sends the first legendary creature of a Commander deck to Commander', () => {
    const legend = { ...c('mtg'), mtgTypeLine: 'Legendary Creature — Elf // Land' }
    expect(defaultSection('mtg', legend, { format: 'commander', commanders: 0 })).toBe('commander')
    expect(defaultSection('mtg', legend, { format: 'commander', commanders: 1 })).toBe('main')
    expect(defaultSection('mtg', legend, { format: 'modern', commanders: 0 })).toBe('main')
    expect(
      defaultSection(
        'mtg',
        { ...c('mtg'), mtgTypeLine: 'Legendary Artifact' },
        { format: 'commander', commanders: 0 }
      )
    ).toBe('main')
    expect(defaultSection('mtg', undefined)).toBe('main')
  })
  it('asks the rules pack whether a card can be a commander, by English name', () => {
    const pack = {
      legal: { 'Krenko, Mob Boss': 1, 'Grist, the Hunger Tide': 1, 'Cool Background': 1, Opt: 1 },
      commander: {
        'Krenko, Mob Boss': '',
        'Grist, the Hunger Tide': '',
        'Cool Background': 'background'
      }
    } as unknown as MtgRulesPack
    const ctx = { format: 'commander', commanders: 0, pack }
    // Search results carry the first card type only; the pack still knows.
    const krenko = { ...c('mtg'), name: 'Krenko, Mob Boss', type: 'Creature' }
    expect(defaultSection('mtg', krenko, ctx)).toBe('commander')
    // A planeswalker that says it can be your commander.
    const grist = {
      ...c('mtg'),
      name: 'Grist, the Hunger Tide',
      mtgTypeLine: 'Legendary Planeswalker'
    }
    expect(defaultSection('mtg', grist, ctx)).toBe('commander')
    // mtgName wins over a printed (non-English) name.
    const ja = { ...c('mtg'), name: 'クレンコ', mtgName: 'Krenko, Mob Boss' }
    expect(defaultSection('mtg', ja, ctx)).toBe('commander')
    // A Background can't lead alone; a card the pack knows as no commander stays in Main even with
    // a legendary creature type line.
    const bg = { ...c('mtg'), name: 'Cool Background' }
    expect(defaultSection('mtg', bg, ctx)).toBe('main')
    const opt = { ...c('mtg'), name: 'Opt', mtgTypeLine: 'Legendary Creature — Liar' }
    expect(defaultSection('mtg', opt, ctx)).toBe('main')
    // A card the pack doesn't know falls back to its type line.
    const fresh = { ...c('mtg'), name: 'Brand New', mtgTypeLine: 'Legendary Creature — Elf' }
    expect(defaultSection('mtg', fresh, ctx)).toBe('commander')
    expect(defaultSection('mtg', krenko, { ...ctx, commanders: 1 })).toBe('main')
    expect(defaultSection('mtg', krenko, { ...ctx, format: 'modern' })).toBe('main')
  })
})
