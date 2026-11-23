import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  guessMtgFormat,
  parseMtgText,
  toArenaText,
  toMtgoText
} from '../../../src/shared/decks/magic/text'
import type { DeckCard, DeckEntry } from '../../../src/shared/decks/types'

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/decks/mtg/${name}`, import.meta.url), 'utf8')

const card = (id: number, name: string, layout: string): DeckCard => ({
  id,
  name,
  type: '',
  frameType: 'mtg',
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
  mtgName: name,
  mtgTypeLine: 'Instant',
  mtgColorIdentity: [],
  mtgManaValue: 1,
  mtgLayout: layout
})

const count = (p: ReturnType<typeof parseMtgText>, section: string): number =>
  p.lines.filter((l) => l.section === section).reduce((n, l) => n + l.qty, 0)

describe('parseMtgText fixtures', () => {
  it('reads an Arena Modern export', () => {
    const p = parseMtgText(fixture('arena-modern.txt'))
    expect(p.sectioned).toBe(true)
    expect(p.skipped).toEqual([])
    expect(count(p, 'main')).toBe(56)
    expect(count(p, 'side')).toBe(3)
    expect(p.lines[0]).toMatchObject({
      qty: 4,
      section: 'main',
      ref: { set: '2X2', number: '117', name: 'Lightning Bolt' }
    })
    expect(p.lines[1].ref).toEqual({ name: 'Delver of Secrets' })
    expect(p.lines[2].ref).toEqual({ set: 'MH2', number: '290', name: 'Fire // Ice' })
  })

  it('reads an Arena Commander export, a Companion going to the sideboard', () => {
    const p = parseMtgText(fixture('arena-commander.txt'))
    expect(p.sectioned).toBe(true)
    expect(p.skipped).toEqual([])
    expect(p.lines.filter((l) => l.section === 'commander').map((l) => l.ref)).toEqual([
      { name: 'Krenko, Mob Boss' }
    ])
    expect(p.lines.filter((l) => l.section === 'side').map((l) => l.ref)).toEqual([
      { name: 'Lurrus of the Dream-Den' }
    ])
    expect(count(p, 'main')).toBe(100)
  })

  it('reads an MTGO export, the first blank line starting the sideboard', () => {
    const p = parseMtgText(fixture('mtgo-legacy.txt'))
    expect(p.sectioned).toBe(true)
    expect(count(p, 'main')).toBe(60)
    expect(count(p, 'side')).toBe(3)
    expect(p.lines.find((l) => l.qty === 2 && l.section === 'main')?.ref).toEqual({
      name: 'Fire // Ice'
    })
  })

  it('reads an MTGO SIDEBOARD: header', () => {
    const p = parseMtgText(fixture('mtgo-sideboard-header.txt'))
    expect(p.sectioned).toBe(true)
    expect(count(p, 'main')).toBe(5)
    expect(p.lines.filter((l) => l.section === 'side')).toHaveLength(1)
  })
})

describe('parseMtgText lines', () => {
  it('reads a set and number', () => {
    expect(parseMtgText('4 Lightning Bolt (2X2) 117').lines[0].ref).toEqual({
      set: '2X2',
      number: '117',
      name: 'Lightning Bolt'
    })
  })
  it('normalises Fire/Ice', () => {
    expect(parseMtgText('1 Fire/Ice').lines[0].ref).toEqual({ name: 'Fire // Ice' })
  })
  it('ignores a *F* foil mark', () => {
    const p = parseMtgText('2 Lightning Bolt (2X2) 117 *F*\n1 Island *F*')
    expect(p.lines.map((l) => l.ref)).toEqual([
      { set: '2X2', number: '117', name: 'Lightning Bolt' },
      { name: 'Island' }
    ])
  })
  it('keeps a parenthesised card name whole', () => {
    expect(parseMtgText('1 B.F.M. (Big Furry Monster)').lines[0].ref).toEqual({
      name: 'B.F.M. (Big Furry Monster)'
    })
  })
  it('skips what it cannot read and ignores comments', () => {
    const p = parseMtgText('hello\n# note\n// note\n0 Island\n1 Island')
    expect(p.skipped.map((s) => s.raw)).toEqual(['hello', '0 Island'])
    expect(p.lines).toHaveLength(1)
    expect(p.sectioned).toBe(false)
  })
})

describe('guessMtgFormat', () => {
  it('reads a 1-2 card Commander header or a 100-card list as Commander', () => {
    expect(guessMtgFormat(parseMtgText('Commander\n1 Krenko\n\nDeck\n4 Opt'))).toBe('commander')
    expect(guessMtgFormat(parseMtgText('Commander\n1 Thrasios\n1 Tymna\n\nDeck\n1 Opt'))).toBe(
      'commander'
    )
    // MTGO: 99 then the commander after a blank line.
    expect(guessMtgFormat(parseMtgText('60 Mountain\n39 Opt\n\n1 Krenko'))).toBe('commander')
  })
  it('guesses nothing otherwise', () => {
    expect(guessMtgFormat(parseMtgText('4 Opt\n56 Mountain\n\n4 Duress'))).toBeNull()
    expect(guessMtgFormat(parseMtgText('Commander\n3 Krenko\n\nDeck\n1 Opt'))).toBeNull()
    expect(guessMtgFormat(parseMtgText('99 Mountain'))).toBeNull()
  })
})

describe('export', () => {
  const cards = {
    1: card(1, 'Lightning Bolt', 'normal'),
    2: card(2, 'Delver of Secrets // Insectile Aberration', 'transform'),
    3: card(3, 'Fire // Ice', 'split'),
    4: card(4, 'Brazen Borrower // Petty Theft', 'adventure'),
    5: card(5, 'Krenko, Mob Boss', 'normal')
  }
  const entries: DeckEntry[] = [
    { section: 'main', card: 1, printing: 'en|1|2X2 117|Uncommon', qty: 4 },
    { section: 'main', card: 2, qty: 4 },
    { section: 'main', card: 3, qty: 2 },
    { section: 'main', card: 4, qty: 1 },
    { section: 'side', card: 1, qty: 1 }
  ]
  const pins = { 'en|1|2X2 117|Uncommon': { set: '2X2', number: '117' } }

  it('writes Arena names, a pin, and the sections', () => {
    const text = toArenaText(entries, cards, pins)
    expect(text).toContain('4 Lightning Bolt (2X2) 117')
    expect(text).toContain('4 Delver of Secrets\n')
    expect(text).not.toContain('Insectile')
    expect(text).toContain('2 Fire // Ice')
    expect(text).toContain('1 Brazen Borrower\n')
    expect(text).toMatch(/^Deck\n/)
    expect(text).toMatch(/\n\nSideboard\n1 Lightning Bolt$/)
  })

  it('round trips through Arena text', () => {
    const p = parseMtgText(toArenaText(entries, cards, pins))
    const got = p.lines.map((l) => [l.section, l.ref.name, l.qty]).sort()
    expect(got).toEqual(
      [
        ['main', 'Lightning Bolt', 4],
        ['main', 'Delver of Secrets', 4],
        ['main', 'Fire // Ice', 2],
        ['main', 'Brazen Borrower', 1],
        ['side', 'Lightning Bolt', 1]
      ].sort()
    )
  })

  it('writes Commander before Deck, and a Commander round trip keeps sections', () => {
    const text = toArenaText(
      [
        { section: 'commander', card: 5, qty: 1 },
        { section: 'main', card: 1, qty: 1 }
      ],
      cards,
      {}
    )
    expect(text).toBe('Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Lightning Bolt')
    expect(parseMtgText(text).lines.map((l) => l.section)).toEqual(['commander', 'main'])
  })

  it('writes MTGO names with Fire/Ice and a sideboard after a blank line', () => {
    const text = toMtgoText(entries, cards)
    expect(text).toContain('2 Fire/Ice')
    expect(text).toContain('4 Delver of Secrets\n')
    expect(text).toMatch(/\n\n1 Lightning Bolt$/)
    expect(text).not.toContain('(2X2)')
  })

  it('puts MTGO commanders in the sideboard position', () => {
    const text = toMtgoText(
      [
        { section: 'commander', card: 5, qty: 1 },
        { section: 'main', card: 1, qty: 1 }
      ],
      cards
    )
    expect(text).toBe('1 Lightning Bolt\n\n1 Krenko, Mob Boss')
  })
})
