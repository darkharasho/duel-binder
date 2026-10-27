import {
  attributeColor,
  formatStat,
  levelLabel,
  splitDesc,
  statBoxes,
  typeLine
} from '@/features/rip/cardFacts'
import type { CardRow } from '../../src/shared/types'

const row = (over: Partial<CardRow>): CardRow => ({
  id: 1,
  name: 'X',
  type: 'Effect Monster',
  frameType: 'effect',
  race: 'Spellcaster',
  attribute: 'DARK',
  level: 7,
  linkval: null,
  atk: 2500,
  def: 2100,
  archetype: null,
  desc: '',
  tcgplayerPrice: null,
  ...over
})

describe('typeLine', () => {
  it.each([
    ['Effect Monster', 'effect', 'Spellcaster', 'Spellcaster / Effect'],
    ['Normal Monster', 'normal', 'Dragon', 'Dragon / Normal'],
    ['Fusion Monster', 'fusion', 'Dragon', 'Dragon / Fusion'],
    ['Synchro Tuner Monster', 'synchro', 'Dragon', 'Dragon / Synchro / Tuner'],
    ['XYZ Monster', 'xyz', 'Warrior', 'Warrior / Xyz'],
    ['Link Monster', 'link', 'Cyberse', 'Cyberse / Link'],
    ['Pendulum Effect Monster', 'effect_pendulum', 'Spellcaster', 'Spellcaster / Pendulum'],
    ['Flip Effect Monster', 'effect', 'Insect', 'Insect / Flip']
  ])('%s is "%s"', (type, frameType, race, want) => {
    expect(typeLine(row({ type, frameType, race }))).toBe(want)
  })
  it('reads spells and traps as card type · kind', () => {
    expect(typeLine(row({ type: 'Spell Card', frameType: 'spell', race: 'Quick-Play' }))).toBe(
      'Spell Card · Quick-Play'
    )
    expect(typeLine(row({ type: 'Trap Card', frameType: 'trap', race: 'Normal' }))).toBe(
      'Trap Card · Normal'
    )
  })
})

describe('levelLabel', () => {
  it('is a level, a rank for an Xyz, a link rating for a Link, nothing for a spell', () => {
    expect(levelLabel(row({ level: 7 }))).toBe('★ Level 7')
    expect(levelLabel(row({ frameType: 'xyz', level: 4 }))).toBe('Rank 4')
    expect(levelLabel(row({ frameType: 'xyz_pendulum', level: 4 }))).toBe('Rank 4')
    expect(levelLabel(row({ frameType: 'link', level: null, linkval: 2 }))).toBe('Link 2')
    expect(levelLabel(row({ type: 'Spell Card', frameType: 'spell', level: null }))).toBeNull()
  })
})

describe('statBoxes', () => {
  it('is ATK and DEF, ? when unknown', () => {
    expect(statBoxes(row({ atk: null, def: -1 }))).toEqual([
      { label: 'ATK', value: '?' },
      { label: 'DEF', value: '?' }
    ])
    expect(statBoxes(row({ atk: 0, def: 0 }))).toEqual([
      { label: 'ATK', value: '0' },
      { label: 'DEF', value: '0' }
    ])
  })
  it('is ATK and LINK-N for a Link, nothing for a trap', () => {
    expect(statBoxes(row({ frameType: 'link', linkval: 4, atk: 3000, def: null }))).toEqual([
      { label: 'ATK', value: '3000' },
      { label: 'LINK', value: 'LINK-4' }
    ])
    expect(statBoxes(row({ type: 'Trap Card', frameType: 'trap' }))).toEqual([])
  })
  it('formatStat', () => {
    expect(formatStat(1800)).toBe('1800')
    expect(formatStat(-1)).toBe('?')
  })
})

describe('splitDesc', () => {
  it("splits an Extra Deck monster's materials off its first line", () => {
    expect(
      splitDesc(row({ frameType: 'synchro', desc: '1 Tuner + 1+ non-Tuners\nEffect.' }))
    ).toEqual({ materials: '1 Tuner + 1+ non-Tuners', text: 'Effect.' })
  })
  it('leaves main deck, one-line and pendulum text as it is', () => {
    expect(splitDesc(row({ desc: 'Line one.\nLine two.' }))).toEqual({
      materials: null,
      text: 'Line one.\nLine two.'
    })
    expect(splitDesc(row({ frameType: 'fusion', desc: 'Must be Fusion Summoned.' }))).toEqual({
      materials: null,
      text: 'Must be Fusion Summoned.'
    })
    expect(
      splitDesc(row({ frameType: 'fusion_pendulum', desc: '[ Pendulum ]\nX' })).materials
    ).toBeNull()
  })
})

describe('attributeColor', () => {
  it('has a colour for each attribute and a grey fallback', () => {
    expect(attributeColor('LIGHT')).not.toBe(attributeColor('DARK'))
    expect(attributeColor('light')).toBe(attributeColor('LIGHT'))
    expect(attributeColor('LAUGH')).toBe('#9ca3af')
  })
})
