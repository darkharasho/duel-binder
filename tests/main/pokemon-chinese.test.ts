import { describe, expect, it } from 'vitest'
import { chineseFiles, chineseListSets, chineseSet, type ZhCard, type ZhSetEntry } from '../../scripts/catalog/pokemon/chinese'
import { cardVersions } from '../../scripts/catalog/pokemon/versions'
import { matchDexRows, type DexCatalogPrinting } from '../../src/shared/dex/match'
import type { DexRow } from '../../src/shared/dex/parse'
import { chinesePromoSets } from '../../scripts/catalog/pokemon/chinesePromos'

const zh = (cardIndex: string, cardName: string, nameEn: string, rarity = 'C', cardType = 'Pokemon'): ZhCard => ({
  cardIndex,
  cardName,
  nameEn,
  rarity,
  cardType
})

describe('chineseSet', () => {
  const { set, cards } = chineseSet([
    zh('001', '蛋蛋', 'Exeggcute'),
    zh('059', '仙子伊布ex', 'sylveon', 'RR'),
    zh('156', 'M沙奈朵EX', 'M Gardevoir-EX', '无标记'),
    zh('R', '梦幻', 'Mew', 'RGB'),
    zh('GRA', '基本草能量', 'Grass Energy', '无标记', 'Basic Energy'),
    zh('MET', '基本钢能量', 'Metal Energy', '无标记', 'Basic Energy')
  ])

  it('names the set in English, with the printed total', () => {
    expect(set).toMatchObject({ id: '30thC', name: '30th Celebration', cardCount: { official: 103 } })
  })
  it('keeps the printed numbers, turning the letter codes into 166 to 176', () => {
    expect(cards.map((c) => c.localId)).toEqual(['001', '059', '156', '166', '169', '176'])
  })
  it('restores a tag the English name lost, and keeps the Chinese name', () => {
    expect(cards[1]).toMatchObject({ name: 'Sylveon ex', localName: '仙子伊布ex', rarity: 'Double rare' })
    expect(cards[2].name).toBe('M Gardevoir-EX')
  })
  it('reads energy, and leaves a rarity the list does not give', () => {
    expect(cards[4]).toMatchObject({ category: 'Energy', rarity: null })
  })
  it('refuses a card it cannot number rather than guess', () => {
    expect(() => chineseSet([zh('XYZ', '?', 'Mew')])).toThrow(/XYZ/)
  })
})

describe('a Dex export of Chinese cards', () => {
  const printing = (id: number, local: string, cardName: string): DexCatalogPrinting => ({
    id,
    cardId: id,
    sourceId: `zh-hans/30thC-${local}`,
    setName: '30th Celebration',
    version: 'Holofoil',
    cardName,
    language: 'zh-hans'
  })
  const row = (number: string, name: string, variant = 'Holo'): DexRow => ({
    locale: 'Simplified Chinese',
    series: 'MEGA',
    set: '30th Celebration',
    id: `scn_30th-${number}`,
    number: `${number}/103`,
    name,
    variant,
    quantity: 1
  })
  const catalog = [
    printing(1, '059', 'Sylveon ex'),
    printing(2, '169', 'Grass Energy'),
    {
      ...printing(3, '059', 'Sylveon ex'),
      id: 3,
      sourceId: 'en/30th-059',
      language: 'en'
    }
  ]

  it('lands on the Chinese printing, never the English card of that number', () => {
    const { wanted, missing } = matchDexRows(
      [row('59', 'Sylveon ex'), row('169', 'Basic Grass Energy')],
      catalog
    )
    expect([...wanted.keys()].sort()).toEqual([1, 2])
    expect(missing).toEqual([])
  })
  it('leaves a Jumbo out', () => {
    const { wanted, missing } = matchDexRows([row('59', 'Sylveon ex', 'Jumbo')], catalog)
    expect(wanted.size).toBe(0)
    expect(missing[0].reason).toBe('finish')
  })
})

const entry = (id: string, code = id, count: number | null = 1): ZhSetEntry => ({
  id,
  code,
  series: 'Scarlet & Violet',
  count
})
const list = (id: string, rows: ZhCard[]) =>
  chineseListSets([entry(id)], new Map([[id, rows]]))
const labels = (id: string, row: ZhCard): string[] => {
  const card = list(id, [row]).sets[0].cards[0]
  return cardVersions(card, [], new Map()).versions.map((v) => v.label)
}

describe('chinesePromoSets', () => {
  const printings = chinesePromoSets().flatMap(({ set, cards }) =>
    cards.flatMap((card) =>
      cardVersions(card, [], new Map()).versions.map((v) => ({
        id: Number(card.localId),
        cardId: Number(card.localId),
        sourceId: `zh-hans/${card.id}`,
        setName: set.name,
        version: v.label,
        cardName: card.name,
        language: 'zh-hans'
      }))
    )
  )
  const promo = (id: string, set: string, number: string, name: string, variant: string): DexRow => ({
    locale: 'Simplified Chinese', series: '', set, id, number, name, variant, quantity: 1
  })

  it('lands every row of the export', () => {
    const { missing, wanted } = matchDexRows(
      [
        promo('scn_30thp-22', '30th Celebration Promos', '22/9', 'Grookey', 'Holo'),
        promo('scn_30thp-23', '30th Celebration Promos', '23/9', 'Scorbunny', 'Holo'),
        promo('scn_30thp-24', '30th Celebration Promos', '24/9', 'Sobble', 'Holo'),
        promo('scn_svp-131', 'Scarlet & Violet Promos', '131/49', 'Darumaka', 'Poké Ball Holo'),
        promo('scn_svp-133', 'Scarlet & Violet Promos', '133/49', 'Remoraid', 'Normal')
      ],
      printings
    )
    expect(missing).toEqual([])
    expect(wanted.size).toBe(5)
  })
})

describe('chineseListSets rarity fixes', () => {
  it('takes a mark the list has wrong from the table, finish and all', () => {
    const index: ZhSetEntry[] = [{ id: 'CSV5C', code: 'CSV5C', series: 'SV', count: 2 }]
    const rows = new Map([['CSV5C', [zh('074', '红腿鹬', 'Flamigo', 'C'), zh('075', '宝贝龙', 'Bagon', 'C')]]])
    const [fixed, plain] = chineseListSets(index, rows).sets[0].cards
    expect(fixed.rarity).toBe('Rare')
    expect(fixed.variants_detailed?.map((v) => v.type)).toEqual(['holo', 'Poke Ball Pattern'])
    expect(plain.rarity).toBe('Common')
  })
})

describe('chineseFiles', () => {
  it('skips the promo rows and folds the 151 waves into their one file', () => {
    const files = chineseFiles([
      entry('PROMO', 'PROMO', null),
      entry('151C-LV', '151C'),
      entry('151C-WANG', '151C'),
      entry('CSV5C')
    ])
    expect([...files.keys()]).toEqual(['151C', 'CSV5C'])
  })
})

describe('chineseListSets', () => {
  it('leaves 30th Celebration to chineseSet', () => {
    expect(chineseListSets([entry('30thC')], new Map([['30thC', [zh('001', '蛋蛋', 'Exeggcute')]]])).sets).toEqual([])
  })
  it('names the set in English, with the list series and the printed number as the id', () => {
    const { set, cards } = list('CSV5C', [zh('012', '蛋蛋', 'Exeggcute')]).sets[0]
    expect(set).toMatchObject({ id: 'CSV5C', name: 'Ardent Obsidian', serie: { id: 'Scarlet & Violet' } })
    expect(cards[0]).toMatchObject({ id: 'CSV5C-012', localId: '012', localName: '蛋蛋' })
  })
  it('keeps a number it can not read, and counts it', () => {
    const r = list('CSV5C', [zh('X-1', '蛋蛋', 'Exeggcute')])
    expect(r.sets[0].cards[0].localId).toBe('X1')
    expect(r.oddNumbers).toBe(1)
  })
  it('names a blank row from another row, a fixed name, or else its set and number', () => {
    const r = list('CSV5C', [
      zh('001', '霜奶仙', 'Alcremie'),
      zh('002', '霜奶仙ex', ''),
      zh('003', '船长 皮卡丘', ''),
      zh('004', '玩家庆典', '', '无标记', 'Stadium')
    ])
    expect(r.sets[0].cards.map((c) => c.name)).toEqual(['Alcremie', 'Alcremie ex', 'Captain Pikachu', 'CSV5C 004'])
    expect(r.sets[0].cards[3].localName).toBe('玩家庆典')
    expect(r).toMatchObject({ named: 2, unnamed: 1 })
  })
  it('corrects a GX the list calls a V, and drops zero-width spaces', () => {
    const names = list('CSV5C', [zh('001', '冰伊布GX', 'Glaceon V'), zh('002', '偷儿狐', '\u200bThievul')])
    expect(names.sets[0].cards.map((c) => c.name)).toEqual(['Glaceon GX', 'Thievul'])
  })
  it('reads the base finish from the mark, in sets with no measured mirror', () => {
    expect(labels('CSV4C', zh('001', '蛋蛋', 'Exeggcute', 'U'))).toEqual(['Normal'])
    expect(labels('CSV4C', zh('001', '蛋蛋', 'Exeggcute', 'R'))).toEqual(['Holofoil'])
    expect(labels('CSV4C', zh('001', '蛋蛋', 'Exeggcute', 'SAR'))).toEqual(['Holofoil'])
  })
  it('adds the mirror only in the sets that show one', () => {
    expect(labels('CSV5C', zh('001', '蛋蛋', 'Exeggcute'))).toEqual(['Normal', 'Poke Ball Pattern'])
    expect(labels('CS2aC', zh('001', '蛋蛋', 'Exeggcute', 'R'))).toEqual(['Holofoil', 'Reverse Holofoil'])
    expect(labels('CSV5C', zh('001', '蛋蛋', 'Exeggcute', 'RR'))).toEqual(['Holofoil'])
    expect(labels('CSV5C', zh('001', '能量', 'Energy', 'U', 'Special Energy'))).toEqual(['Normal'])
  })
  it('foils an unmarked card only on a foil tag', () => {
    expect(labels('CSVH3C', zh('001', '蛋蛋', 'Exeggcute', '无标记'))).toEqual(['Normal'])
    expect(labels('CSVH3C', { ...zh('001', '铁辙迹ex', 'Iron Treads ex', '无标记'), is: ['ex', 'Basic'] })).toEqual(['Holofoil'])
  })
  it('reads a Gem Pack finish from the number, and leaves an unmeasured one plain', () => {
    const gem = (id: string, n: string, mark: string): string[] => labels(id, zh(n, '蛋蛋', 'Exeggcute', mark))
    expect(gem('CBB4C', '0101', '●')).toEqual(['Holofoil'])
    expect(gem('CBB4C', '0102', '●')).toEqual(['Poke Ball Pattern'])
    expect(gem('CBB4C', '0103', '◆')).toEqual(['Starlight Holo'])
    expect(gem('CBB4C', '0105', '★')).toEqual(['Master Ball Pattern'])
    expect(gem('CBB4C', '0106', '★★')).toEqual(['Set Logo Holofoil'])
    expect(gem('CBB6C', '0103', '◆')).toEqual(['Holofoil'])
    expect(gem('CBB2C', '0113', '★')).toEqual(['Holofoil'])
    expect(gem('CBB1C', '0105', '★')).toEqual(['Holofoil'])
  })
  it('counts the rule-made finishes as unverified, with no problems', () => {
    const card = list('CBB4C', [zh('0106', '蛋蛋', 'Exeggcute', '★★')]).sets[0].cards[0]
    expect(cardVersions(card, [], new Map())).toMatchObject({ unverified: true, problems: [] })
  })
})

describe('a Dex export of the other Chinese sets', () => {
  const zhPrinting = (id: number, sourceId: string, setName: string, version: string, cardName: string): DexCatalogPrinting => ({
    id,
    cardId: id,
    sourceId: `zh-hans/${sourceId}`,
    setName,
    version,
    cardName,
    language: 'zh-hans'
  })
  const scn = (id: string, set: string, name: string, variant: string): DexRow => ({
    locale: 'Simplified Chinese',
    series: 'Scarlet & Violet',
    set,
    id,
    number: `${id.split('-')[1]}/100`,
    name,
    variant,
    quantity: 1
  })
  const catalog = [
    zhPrinting(1, 'CSV9.5C-012', 'Terastal Gathering', 'Normal', 'Mew'),
    zhPrinting(2, 'CSIC-002', 'Trainer Collection Gift Box', 'Normal', 'Bea'),
    zhPrinting(3, '151C-046', 'Collection 151', 'Normal', 'Paras'),
    zhPrinting(4, 'CBB4C-0103', 'Gem Pack Vol. 4', 'Starlight Holo', 'Ponyta'),
    zhPrinting(5, 'CBB4C-0106', 'Gem Pack Vol. 4', 'Set Logo Holofoil', 'Ponyta'),
    zhPrinting(6, 'CBB6C-1001', 'Gem Pack Vol. 6', 'Holofoil', 'Castform Sunny Form'),
    { ...zhPrinting(7, 'CSV5C-012', 'Ardent Obsidian', 'Normal', 'Mew'), sourceId: 'en/sv05-012', language: 'en' }
  ]
  const landed = (row: DexRow): number[] => [...matchDexRows([row], catalog).wanted.keys()]
  const reason = (row: DexRow): string | undefined => matchDexRows([row], catalog).missing[0]?.reason

  it('finds a set by its scn_ code: dots dropped, trailing C dropped, any case', () => {
    expect(landed(scn('scn_csv95-12', 'Terastal Gathering', 'Mew', 'Normal'))).toEqual([1])
    expect(landed(scn('scn_csI-2', 'Trainer Collection Gift Box', 'Bea', 'Normal'))).toEqual([2])
    expect(landed(scn('scn_151-46', 'Collection 151', 'Paras', 'Normal'))).toEqual([3])
  })
  it('lands an unchecked set whose Dex name differs from ours, by code alone', () => {
    expect(landed(scn('scn_csv95-12', 'Another Name', 'Mew', 'Normal'))).toEqual([1])
  })
  it('places Starlight, and the stamp on its stamped card', () => {
    expect(landed(scn('scn_cbb4-103', 'Gem Pack Vol. 4', 'Ponyta', 'Starlight Holo'))).toEqual([4])
    expect(landed(scn('scn_cbb4-106', 'Gem Pack Vol. 4', 'Ponyta', 'Expansion Stamp'))).toEqual([5])
  })
  it('takes a Chinese form in Dex word order', () => {
    expect(landed(scn('scn_cbb6-1001', 'Gem Pack Vol. 6', 'Sunny Form Castform', 'Holo'))).toEqual([6])
  })
  it('reports a finish it can not place', () => {
    expect(reason(scn('scn_csv95-12', 'Terastal Gathering', 'Mew', 'Master Ball Holo'))).toBe('finish')
  })
  it('reports a set the list lacks, and never reaches the English twin', () => {
    expect(reason(scn('scn_svp-131', 'Scarlet & Violet Promos', 'Darumaka', 'Normal'))).toBe('set')
    expect(reason(scn('scn_csv5-12', 'Ardent Obsidian', 'Mew', 'Normal'))).toBe('set')
  })
  it('reports a name that disagrees rather than trust the number', () => {
    expect(reason(scn('scn_csv95-12', 'Terastal Gathering', 'Barraskewda', 'Normal'))).toBe('name')
  })
})
