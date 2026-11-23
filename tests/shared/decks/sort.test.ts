import { describe, expect, it } from 'vitest'
import { sortEntries } from '../../../src/shared/decks/sort'
import type { DeckCard, DeckEntry } from '../../../src/shared/decks/types'

const op = (
  id: number,
  name: string,
  opCardType: string,
  opCost: number | null,
  opNumber: string
): DeckCard => ({
  id,
  name,
  type: opCardType,
  frameType: 'op',
  imageId: null,
  owned: 0,
  price: null,
  regionPrice: null,
  sourceId: null,
  code: null,
  opNumber,
  opCardType,
  opColors: ['Red'],
  opCost,
  opBlock: 1,
  mtgName: null,
  mtgTypeLine: null,
  mtgColorIdentity: [],
  mtgManaValue: null,
  mtgLayout: null
})

describe('sortEntries for op', () => {
  it('puts the Leader first, then Characters, Events and Stages, each by cost', () => {
    const cards: Record<number, DeckCard> = {
      1: op(1, 'Thousand Sunny', 'Stage', 2, 'OP01-119'),
      2: op(2, 'Gum-Gum Jet Pistol', 'Event', 1, 'OP01-026'),
      3: op(3, 'Nami', 'Character', 3, 'OP01-016'),
      4: op(4, 'Usopp', 'Character', 1, 'OP01-004'),
      5: op(5, 'Monkey.D.Luffy', 'Leader', 5, 'OP01-003')
    }
    const entries: DeckEntry[] = [1, 2, 3, 4, 5].map((card) => ({
      section: card === 5 ? 'leader' : 'main',
      card,
      qty: 1
    }))
    expect(sortEntries('op', entries, cards).map((e) => e.card)).toEqual([5, 4, 3, 2, 1])
  })

  it('puts a card with no cost last in its type, then orders by number, name and id', () => {
    const cards: Record<number, DeckCard> = {
      1: op(1, 'Ace', 'Character', null, 'OP01-001'),
      2: op(2, 'Brook', 'Character', 2, 'OP01-030'),
      3: op(3, 'Yasopp', 'Character', 2, 'OP01-020'),
      4: op(4, 'Sanji', 'Character', 2, 'OP01-020'),
      5: op(5, 'Sanji', 'Character', 2, 'OP01-020')
    }
    const entries: DeckEntry[] = [1, 2, 3, 5, 4].map((card) => ({ section: 'main', card, qty: 1 }))
    expect(sortEntries('op', entries, cards).map((e) => e.card)).toEqual([4, 5, 3, 2, 1])
  })
})

describe('sortEntries for mtg', () => {
  const mtg = (id: number, name: string, typeLine: string, mv: number | null): DeckCard => ({
    ...op(id, name, '', null, ''),
    opCardType: null,
    opNumber: null,
    opBlock: null,
    opColors: [],
    mtgName: name,
    mtgTypeLine: typeLine,
    mtgManaValue: mv
  })
  it('puts the commander first, then types in order, each by mana value', () => {
    const cards: Record<number, DeckCard> = {
      1: mtg(1, 'Forest', 'Basic Land — Forest', 0),
      2: mtg(2, 'Shock', 'Instant', 1),
      3: mtg(3, 'Grizzly Bears', 'Creature — Bear', 3),
      4: mtg(4, 'Llanowar Elves', 'Creature — Elf Druid', 1),
      5: mtg(5, 'Atraxa', 'Legendary Creature — Phyrexian Angel Horror', 4)
    }
    const entries: DeckEntry[] = [1, 2, 3, 4, 5].map((card) => ({
      section: card === 5 ? 'commander' : 'main',
      card,
      qty: 1
    }))
    expect(sortEntries('mtg', entries, cards).map((e) => e.card)).toEqual([5, 4, 3, 2, 1])
  })
  it('ranks an unknown type 8 and a missing mana value last', () => {
    const cards: Record<number, DeckCard> = {
      1: mtg(1, 'A', 'Kindred', 0),
      2: mtg(2, 'B', 'Land', null),
      3: mtg(3, 'C', 'Land', 2)
    }
    const entries: DeckEntry[] = [1, 2, 3].map((card) => ({ section: 'main', card, qty: 1 }))
    expect(sortEntries('mtg', entries, cards).map((e) => e.card)).toEqual([3, 2, 1])
  })
})
