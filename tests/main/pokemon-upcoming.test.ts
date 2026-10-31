import { describe, it, expect } from 'vitest'
import {
  parseAttack,
  upcomingGroups,
  upcomingSet
} from '../../scripts/catalog/pokemon/upcoming'
import type { TcCardRow, TcGroup, TdSet } from '../../scripts/catalog/pokemon/types'

const group: TcGroup = {
  groupId: 24831,
  name: 'ME06: Delta Reign',
  abbreviation: 'DLR',
  publishedOn: '2026-11-06T00:00:00'
}
const row = (productId: number, name: string, details: Record<string, string>): TcCardRow => ({
  productId,
  name,
  details
})
const golisopod = row(726512, 'Mega Golisopod ex - 011/103', {
  Number: '011/103',
  Rarity: 'Double Rare',
  'Card Type': 'Grass',
  HP: '340',
  Stage: 'Stage 1',
  'Attack 1': "[G] Finishing Blow (60+)<br> If your opponent's Active Pokémon is hurt, 160 more.",
  'Attack 2': '[CCC] Quadruple Hold (160)'
})

describe('upcomingGroups', () => {
  const known = [{ id: 'me05', name: 'Pitch Black' }] as TdSet[]
  it('takes numbered Mega Evolution groups TCGdex has no set for', () => {
    expect(upcomingGroups([group], known)).toEqual([group])
  })
  it('leaves sets TCGdex has, by id or by name, and groups with no set number', () => {
    const groups: TcGroup[] = [
      { groupId: 1, name: 'ME05: Pitch Black', abbreviation: 'PBL' },
      { groupId: 2, name: 'ME: Mega Evolution Promo', abbreviation: 'MEP' },
      { groupId: 3, name: 'SWSH06: Chilling Reign', abbreviation: 'SWSH06' }
    ]
    expect(upcomingGroups(groups, known)).toEqual([])
    expect(upcomingGroups([group], [{ id: 'me6', name: 'Delta Reign' }] as TdSet[])).toEqual([])
  })
})

describe('upcomingSet', () => {
  it('builds the set with the ids TCGdex would use', () => {
    const { set, cards } = upcomingSet(group, [golisopod])!
    expect(set).toMatchObject({
      id: 'me06',
      name: 'Delta Reign',
      releaseDate: '2026-11-06',
      abbreviation: { official: 'DLR' },
      cardCount: { official: 103, total: 1 }
    })
    expect(set.cards).toEqual([{ id: 'me06-011', localId: '011', name: 'Mega Golisopod ex' }])
    expect(cards[0]).toMatchObject({
      id: 'me06-011',
      category: 'Pokemon',
      rarity: 'Double rare',
      hp: 340,
      stage: 'Stage1',
      types: ['Grass'],
      thirdParty: { tcgplayer: 726512 }
    })
    expect(cards[0].attacks).toHaveLength(2)
  })

  it('reads trainers, energy, abilities and side notes', () => {
    const { cards } = upcomingSet(group, [
      row(1, 'Legendary Pyroduct - 094/103 (Left)', {
        Number: '094/103',
        'Card Type': 'Trainer - Stadium'
      }),
      row(2, 'Pokemon Catcher', { Number: '129/103', 'Card Type': 'Trainer - Item' }),
      row(3, 'Bubbly W Energy', { Number: '132/103', 'Card Type': 'Special Water Energy' }),
      row(4, 'Thundurus', {
        Number: '035/103',
        'Card Type': 'Lightning',
        CardText: '<strong>Ability: Incarnate Solidarity</strong> Ignore <em>this</em>.'
      })
    ])!
    expect(cards.map((c) => [c.localId, c.name, c.category])).toEqual([
      ['035', 'Thundurus', 'Pokemon'],
      ['094', 'Legendary Pyroduct', 'Trainer'],
      ['129', 'Pokémon Catcher', 'Trainer'],
      ['132', 'Bubbly W Energy', 'Energy']
    ])
    expect(cards[0].abilities).toEqual([
      { type: 'Ability', name: 'Incarnate Solidarity', effect: 'Ignore this.' }
    ])
    expect(cards[1].types).toBeUndefined()
  })

  it('skips sealed products and keeps one product per number', () => {
    const { cards } = upcomingSet(group, [
      row(9, 'Delta Reign Booster Box', {}),
      golisopod,
      row(726513, 'Mega Golisopod ex (Duplicate)', { Number: '011/103' })
    ])!
    expect(cards.map((c) => c.thirdParty?.tcgplayer)).toEqual([726512])
  })

  it('is nothing until a single is listed', () => {
    expect(upcomingSet(group, [row(9, 'Delta Reign Booster Box', {})])).toBeNull()
  })
})

describe('parseAttack', () => {
  it('reads cost, damage and effect', () => {
    expect(parseAttack('[LLC] Thunder (120×)<br> Flip <em>a</em> coin.')).toEqual({
      cost: ['Lightning', 'Lightning', 'Colorless'],
      name: 'Thunder',
      damage: '120×',
      effect: 'Flip a coin.'
    })
  })
  it('reads an attack with no damage or no cost', () => {
    expect(parseAttack('[] Call for Family<br> Search.')).toEqual({
      cost: [],
      name: 'Call for Family',
      effect: 'Search.'
    })
  })
  it('is null for text that is not an attack', () => {
    expect(parseAttack('Nothing here')).toBeNull()
  })
})
