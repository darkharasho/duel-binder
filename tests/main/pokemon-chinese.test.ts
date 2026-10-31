import { describe, expect, it } from 'vitest'
import { chineseSet, type ZhCard } from '../../scripts/catalog/pokemon/chinese'
import { matchDexRows, type DexCatalogPrinting } from '../../src/shared/dex/match'
import type { DexRow } from '../../src/shared/dex/parse'

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
