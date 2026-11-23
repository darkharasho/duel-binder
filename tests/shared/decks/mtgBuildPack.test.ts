import { describe, expect, it } from 'vitest'
import {
  anyNumberCap,
  buildMtgPack,
  commanderKind,
  type MtgPackCard
} from '../../../src/shared/decks/magic/buildPack'
import { mtgLegality, parseRulesPack } from '../../../src/shared/decks/pack'

const card = (o: Partial<MtgPackCard> & { name: string }): MtgPackCard => ({
  layout: 'normal',
  legalities: { commander: 'legal' },
  released_at: '2020-01-01',
  ...o
})
const builtAt = new Date('2026-11-23T10:00:00Z')
const build = (cards: MtgPackCard[]) =>
  buildMtgPack(cards, { version: '2026-11-23T09:00:00+00:00', builtAt })

describe('buildMtgPack', () => {
  it('reads legality bits per format', () => {
    const pack = build([
      card({
        name: 'Black Lotus',
        legalities: {
          vintage: 'restricted',
          legacy: 'banned',
          commander: 'banned',
          modern: 'not_legal'
        }
      })
    ])
    expect(mtgLegality(pack, 'Black Lotus', 'vintage')).toBe(2)
    expect(mtgLegality(pack, 'Black Lotus', 'legacy')).toBe(3)
    expect(mtgLegality(pack, 'Black Lotus', 'commander')).toBe(3)
    expect(mtgLegality(pack, 'Black Lotus', 'modern')).toBe(0)
    expect(mtgLegality(pack, 'Nope', 'modern')).toBeNull()
  })
  it('caps any-number and up-to cards', () => {
    expect(
      anyNumberCap(
        card({
          name: 'Relentless Rats',
          oracle_text: 'A deck can have any number of cards named Relentless Rats.'
        })
      )
    ).toBe(0)
    expect(
      anyNumberCap(
        card({
          name: 'Seven Dwarves',
          oracle_text: 'A deck can have up to seven cards named Seven Dwarves.'
        })
      )
    ).toBe(7)
    expect(
      anyNumberCap(
        card({ name: 'Nine', oracle_text: 'A deck can have up to nine cards named Nine.' })
      )
    ).toBe(9)
    expect(anyNumberCap(card({ name: 'Bear', oracle_text: 'Trample' }))).toBeNull()
  })
  it('classifies commander kinds', () => {
    const k = (type_line: string, oracle_text = '', keywords: string[] = []) =>
      commanderKind(card({ name: 'X', type_line, oracle_text, keywords }))
    expect(k('Legendary Creature — Elf')).toBe('')
    expect(k('Creature — Elf')).toBeNull()
    expect(k('Legendary Planeswalker — Jace', 'Jace can be your commander.')).toBe('')
    expect(k('Legendary Planeswalker — Jace')).toBeNull()
    expect(
      k('Legendary Creature — Merfolk', 'Partner (You can have two commanders.)', ['Partner'])
    ).toBe('partner')
    expect(
      k(
        'Legendary Creature — Human',
        'Partner with Toothy, Imaginary Friend (When this enters, target player may put Toothy into their hand.)',
        ['Partner with']
      )
    ).toBe('partner-with:Toothy, Imaginary Friend')
    expect(
      k(
        'Legendary Creature — Human',
        'Friends forever (You can have two commanders if both have friends forever.)'
      )
    ).toBe('friends')
    expect(
      k(
        'Legendary Creature — Human',
        'Choose a Background (You can have a Background as a second commander.)'
      )
    ).toBe('background-chooser')
    expect(k('Legendary Enchantment — Background')).toBe('background')
    expect(
      k(
        'Legendary Creature — Human',
        "Doctor's companion (You can have two commanders if the other is a Doctor.)"
      )
    ).toBe('companion')
    expect(k('Legendary Creature — Time Lord Doctor')).toBe('doctor')
    expect(
      k(
        'Legendary Creature — Human',
        'Partner—Father & son (You can have two commanders if both have this.)'
      )
    ).toBe('variant:Father & son')
  })
  it('lets legendary Vehicles and Spacecraft with printed power and toughness lead (Edge of Eternities rules, Wizards release notes 2025)', () => {
    const v = (type_line: string, pt = true) =>
      commanderKind(card({ name: 'V', type_line, ...(pt ? { power: '4', toughness: '4' } : {}) }))
    expect(v('Legendary Artifact — Vehicle')).toBe('')
    expect(v('Legendary Artifact — Spacecraft')).toBe('')
    expect(v('Legendary Artifact — Spacecraft', false)).toBeNull()
    expect(v('Artifact — Vehicle')).toBeNull()
  })
  it('reads a modal DFC from its front face', () => {
    const c = card({
      name: 'Front // Back',
      layout: 'modal_dfc',
      card_faces: [
        { name: 'Front', type_line: 'Legendary Creature — Human', oracle_text: '' },
        { name: 'Back', type_line: 'Land', oracle_text: '' }
      ]
    })
    expect(commanderKind(c)).toBe('')
    expect(commanderKind({ ...c, card_faces: [c.card_faces![1], c.card_faces![0]] })).toBeNull()
  })
  it('lists unreleased new cards but not reprints', () => {
    const pack = build([
      card({ name: 'Newbie', released_at: '2026-12-05' }),
      card({ name: 'Reprinted', released_at: '2026-12-05', reprint: true }),
      card({ name: 'Today', released_at: '2026-11-23' })
    ])
    expect(pack.upcoming).toEqual({ Newbie: '2026-12-05' })
  })
  it('skips Alchemy and unlegal cards, keeps paper cards whose oracle printing is MTGO-only, and the pack parses', () => {
    const pack = build([
      card({ name: 'Paper' }),
      card({ name: 'Black Lotus' }),
      card({ name: 'A-Rebalanced' }),
      card({ name: 'Nowhere', legalities: { commander: 'not_legal' } })
    ])
    expect(Object.keys(pack.legal)).toEqual(['Paper', 'Black Lotus'])
    expect(parseRulesPack(pack).state).toBe('ready')
    expect(pack.sources).toEqual([{ name: 'Scryfall', fetchedAt: '2026-11-23T09:00:00+00:00' }])
  })
})
