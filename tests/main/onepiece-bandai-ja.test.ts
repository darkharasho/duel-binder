import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseCardList, parseSeriesList } from '../../scripts/catalog/onepiece/bandai'

const read = (name: string): string =>
  readFileSync(join(__dirname, '../fixtures/onepiece', name), 'utf8')

describe("Bandai's Japanese card list", () => {
  test('series list: full-width brackets, Japanese kinds and the special pages', () => {
    const { series, notes } = parseSeriesList(read('bandai-ja-op17.html'))
    expect(notes).toEqual([])
    expect(series).toEqual([
      {
        id: '550204',
        kind: 'booster',
        title: 'EGGHEAD CRISIS',
        code: 'EB-04',
        setName: 'EGGHEAD CRISIS [EB-04]',
        setCode: 'EB04'
      },
      {
        id: '550117',
        kind: 'booster',
        title: '世界最強の戦士',
        code: 'OP-17',
        setName: '世界最強の戦士 [OP-17]',
        setCode: 'OP17'
      },
      {
        id: '550114',
        kind: 'booster',
        title: '蒼海の七傑',
        code: 'OP-14',
        setName: '蒼海の七傑 [OP-14]',
        setCode: 'OP14'
      },
      {
        id: '550013',
        kind: 'deck',
        title: '3兄弟の絆',
        code: 'ST-13',
        setName: '3兄弟の絆 [ST-13]',
        setCode: 'ST13'
      },
      {
        id: '550701',
        kind: 'deck',
        title: 'Family Deck Set',
        code: 'FDS',
        setName: 'Family Deck Set',
        setCode: 'FDS'
      },
      {
        id: '550901',
        kind: 'promo',
        title: 'Promotion Cards',
        code: 'P',
        setName: 'Promotion Cards',
        setCode: 'P'
      },
      {
        id: '550801',
        kind: 'other',
        title: 'Other Product Cards',
        code: 'OPC',
        setName: 'Other Product Cards',
        setCode: 'OPC'
      }
    ])
  })

  test('cards: Japanese labels, colors and attributes read into the English vocabulary', () => {
    const { entries, skipped } = parseCardList(read('bandai-ja-op17.html'), '550117')
    expect(skipped).toEqual([])
    const by = Object.fromEntries(entries.map((e) => [e.bandaiId, e]))
    expect(by['OP17-001']).toMatchObject({
      number: 'OP17-001',
      rarity: 'L',
      cardType: 'Leader',
      name: 'エドワード・ニューゲート',
      life: 5,
      cost: null,
      power: 5000,
      counter: null,
      colors: ['Red'],
      attribute: ['Special'],
      traits: ['四皇', '白ひげ海賊団'],
      block: 5,
      cardSets: 'ブースターパック 世界最強の戦士【OP-17】'
    })
    expect(by['OP17-019']).toMatchObject({
      cardType: 'Event',
      cost: 1,
      power: null,
      attribute: [],
      trigger: '【トリガー】自分のリーダーを、このターン中、パワー+1000。'
    })
    expect(by['OP17-061']).toMatchObject({ attribute: ['Strike', 'Special'], colors: ['Purple'] })
    expect(by['EB04-007_p2']).toMatchObject({
      number: 'EB04-007',
      rarity: 'SP',
      colors: ['Red'],
      attribute: ['Slash']
    })
    expect(by['EB04-061_p3']).toMatchObject({
      rarity: 'SEC',
      cardType: 'Character',
      colors: ['Yellow'],
      block: null
    })
    expect(by['EB04-061_p3'].effect).toMatch(
      /^手札のこのカードは、自分のライフが1枚以下の場合、コスト-1。\n【登場時】/
    )
  })

  test("a typo'd Japanese card type still reads as its type", () => {
    const html = read('bandai-ja-op17.html').replace(
      '<span>CHARACTER</span>',
      '<span>キャラクタークター</span>'
    )
    const { entries } = parseCardList(html, '550117')
    expect(entries.find((e) => e.bandaiId === 'EB04-061_p3')!.cardType).toBe('Character')
  })

  test('two colors and an unknown color', () => {
    const html = read('bandai-ja-op17.html')
      .replace('<h3>色</h3>赤</div>', '<h3>色</h3>青/黒</div>')
      .replace('<h3>色</h3>紫</div>', '<h3>色</h3>金</div>')
    const { entries } = parseCardList(html, '550117')
    expect(entries.find((e) => e.bandaiId === 'OP17-001')!.colors).toEqual(['Blue', 'Black'])
    expect(entries.find((e) => e.bandaiId === 'OP17-061')!.colors).toEqual(['金'])
  })
})
