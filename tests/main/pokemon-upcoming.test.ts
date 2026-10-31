import { describe, it, expect } from 'vitest'
import {
  parseAttack,
  tcgplayerOnlyCards,
  upcomingGroups,
  upcomingSet
} from '../../scripts/catalog/pokemon/upcoming'
import type { TcCardRow, TcGroup, TcProduct, TdCard, TdSet } from '../../scripts/catalog/pokemon/types'

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

describe('Japanese upcoming sets', () => {
  const m6a: TcGroup = {
    groupId: 24721,
    name: 'M6a: MEGA Expansion 30th Celebration',
    abbreviation: 'm6a',
    publishedOn: '2026-09-16T00:00:00'
  }
  const mf: TcGroup = { groupId: 24856, name: 'MF: 30th CELEBRATION Premium Deck Set', abbreviation: 'mF' }

  it('takes Mega era groups TCGdex has no set for, whatever their case', () => {
    const known = [{ id: 'M1L', name: 'メガブレイブ' }] as TdSet[]
    const groups: TcGroup[] = [
      m6a,
      mf,
      { groupId: 1, name: 'm1L: Mega Brave', abbreviation: 'm1L' },
      { groupId: 2, name: 'M-P Promotional Cards', abbreviation: null },
      { groupId: 3, name: 'SV: ex Start Decks', abbreviation: 'svD' },
      { groupId: 4, name: 'Start Deck 100 Battle Collection', abbreviation: null }
    ]
    expect(upcomingGroups(groups, known, 'ja')).toEqual([m6a, mf])
  })

  it('builds the set in English, with TCGdex-style ids and letter numbers last', () => {
    const { set, cards } = upcomingSet(
      m6a,
      [
        row(1, 'MEGA Expansion 30th Celebration Booster Box', {}),
        row(717600, 'Mew - R/RGB', { Number: 'R/RGB', Rarity: 'RGB Rare' }),
        row(716942, 'Basic Darkness Energy', { Number: 'DAR', Rarity: 'Futuristic Rare' }),
        row(716804, 'Alolan Exeggutor - 002/103', { Number: '002/103', Rarity: 'None' }),
        row(716924, 'Fuecoco ex - 124/103', { Number: '124/103', Rarity: 'Special Art Rare' }),
        row(716995, 'Gengar (Prime)', { Number: '150/103', Rarity: 'Classic Collection' })
      ],
      'ja'
    )!
    expect(set).toMatchObject({ id: 'M6a', name: 'MEGA Expansion 30th Celebration', serie: { id: 'M' } })
    expect(set.abbreviation).toBeUndefined()
    expect(set.cardCount).toEqual({ official: 103, total: 5 })
    expect(cards.map((c) => [c.id, c.name, c.rarity, c.category, c.printed])).toEqual([
      ['M6a-002', 'Alolan Exeggutor', null, undefined, undefined],
      ['M6a-124', 'Fuecoco ex', 'Special illustration rare', undefined, undefined],
      ['M6a-150', 'Gengar', 'Classic Collection', undefined, undefined],
      ['M6a-DAR', 'Basic Darkness Energy', 'Futuristic Rare', 'Energy', 'DAR'],
      ['M6a-R', 'Mew', 'RGB Rare', undefined, 'R/RGB']
    ])
  })

  it("reads category 85's CardType", () => {
    const { cards } = upcomingSet(
      mf,
      [
        row(1, 'Potion', { Number: '028/040', CardType: 'Trainer - Item' }),
        row(2, 'Tropius', { Number: '001/040', CardType: 'Grass', HP: '120', Stage: 'Basic' })
      ],
      'ja'
    )!
    expect(cards.map((c) => [c.id, c.category, c.types, c.hp])).toEqual([
      ['MF-001', 'Pokemon', ['Grass'], 120],
      ['MF-028', 'Trainer', undefined, undefined]
    ])
  })
})

describe('tcgplayerOnlyCards', () => {
  const product = (
    productId: number,
    name: string,
    number: string | null,
    details: Record<string, string> = {}
  ): TcProduct => ({
    productId,
    groupId: 1,
    name,
    number,
    imageUrl: `https://x/${productId}_200w.jpg`,
    details
  })
  const mep = { id: 'mep', name: 'MEP Black Star Promos', serie: { id: 'me' }, cards: [] } as unknown as TdSet
  const thirty = { ...mep, id: '30th', cardCount: { official: 128 } } as TdSet
  const has = (id: string, localId: string, tcgplayer?: number): TdCard =>
    ({ id, localId, name: 'X', set: mep, ...(tcgplayer ? { thirdParty: { tcgplayer } } : {}) }) as TdCard

  it('adds a number TCGdex lacks, with its id and without the name tail', () => {
    const { cards, notes } = tcgplayerOnlyCards(mep, [has('mep-001', '001')], [
      product(1, 'Pikachu - 001', '001'),
      product(713286, 'Victini - 102 (30th Celebration)', '102', {
        Rarity: 'Promo',
        'Card Type': 'Fire',
        HP: '80'
      })
    ])
    expect(notes).toEqual([])
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      id: 'mep-102',
      localId: '102',
      name: 'Victini',
      rarity: 'Promo',
      category: 'Pokemon',
      printed: '102',
      thirdParty: { tcgplayer: 713286 }
    })
  })

  it('gives a letter number the part before the slash, as "exu-!" does', () => {
    const { cards } = tcgplayerOnlyCards(thirty, [], [
      product(717607, 'Mew - R/RGB', 'R/RGB'),
      product(717608, 'Mew - G/RGB', 'G/RGB'),
      product(717609, 'Mew - B/RGB', 'B/RGB')
    ])
    expect(cards.map((c) => [c.id, c.name, c.printed])).toEqual([
      ['30th-R', 'Mew', 'R/RGB'],
      ['30th-G', 'Mew', 'G/RGB'],
      ['30th-B', 'Mew', 'B/RGB']
    ])
  })

  it('makes the other products of a number versions of its one card', () => {
    const { cards, notes } = tcgplayerOnlyCards(mep, [], [
      product(713260, 'Nidorina - 101 (30th Celebration)', '101'),
      product(713261, 'Nidorina - 101 (30th Celebration) (Pokemon Center Exclusive)', '101'),
      product(714597, 'Paradise Resort - 092 (World Championships 2026)', '092', { 'Card Type': 'Stadium' }),
      product(714598, 'Paradise Resort - 092 (World Championships 2026) [Staff]', '092', { 'Card Type': 'Stadium' }),
      product(712963, 'Pikachu - 093', '093'),
      product(716740, 'Pikachu - 093 (Winner)', '093')
    ])
    expect(notes).toEqual([])
    const subtypes = (c: TdCard): unknown[] =>
      c.variants_detailed!.map((v) => [v.subtype, v.thirdParty?.tcgplayer])
    expect(cards.map((c) => c.id).sort()).toEqual(['mep-092', 'mep-093', 'mep-101'])
    const by = new Map(cards.map((c) => [c.localId, c]))
    expect(by.get('092')).toMatchObject({ name: 'Paradise Resort', category: 'Trainer' })
    expect(subtypes(by.get('101')!)).toEqual([[undefined, 713260], ['Pokemon Center Exclusive', 713261]])
    expect(subtypes(by.get('092')!)).toEqual([[undefined, 714597], ['Staff', 714598]])
    expect(subtypes(by.get('093')!)).toEqual([[undefined, 712963], ['Winner', 716740]])
  })

  it('leaves out a number whose products name two cards or have no plain one', () => {
    const { cards, notes } = tcgplayerOnlyCards(mep, [], [
      product(1, 'Mew - 200', '200'),
      product(2, 'Mewtwo - 200', '200'),
      product(3, 'Eevee - 201 (Staff)', '201'),
      product(4, 'Eevee - 201 (Winner)', '201')
    ])
    expect(cards).toEqual([])
    expect(notes).toHaveLength(2)
  })

  it('leaves a product it can not trust', () => {
    const noPicture = { ...product(1, 'Poke Pad - 052/M-P', '052/M-P'), imageUrl: undefined }
    const m1l = { ...thirty, id: 'M1L', serie: { id: 'M' }, cardCount: { official: 63 } } as TdSet
    const { cards, notes } = tcgplayerOnlyCards(m1l, [has('M1L-001', '001', 9)], [
      noPicture,
      product(2, 'Mew ex - 002/043', '151/165'),
      product(3, 'Sealed Box', null),
      product(4, 'Code Card - Delta Reign', '999'),
      product(9, 'Mistyped - 300', '300'),
      product(5, 'Junk', 'a b')
    ])
    expect(cards).toEqual([])
    expect(notes).toHaveLength(3)
  })

  it('leaves older series and sets with numbers of their own alone', () => {
    const old = { ...mep, serie: { id: 'sv' } } as TdSet
    const classic = { ...mep, id: '30th-c' } as TdSet
    const rows = [product(1, 'Mew - 200', '200')]
    expect(tcgplayerOnlyCards(old, [], rows).cards).toEqual([])
    expect(tcgplayerOnlyCards(classic, [], rows).cards).toEqual([])
  })
})
