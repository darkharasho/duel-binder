import { setSeries } from '../../scripts/catalog/pokemon/series'
import type { TdSet } from '../../scripts/catalog/pokemon/types'

const set = (id: string, serie?: { id: string; name?: string }): TdSet => ({
  id,
  name: id,
  serie,
  cards: []
})

const ENGLISH = [
  set('me01', { id: 'me', name: 'Mega Evolution' }),
  set('sv01', { id: 'sv', name: 'Scarlet & Violet' }),
  set('swsh1', { id: 'swsh', name: 'Sword & Shield' })
]

describe('setSeries', () => {
  it("an English set takes TCGdex's name; one built with only an id takes the English series of it", () => {
    expect(setSeries('en', [...ENGLISH, set('me06', { id: 'me' })], ENGLISH)).toEqual([
      'Mega Evolution',
      'Scarlet & Violet',
      'Sword & Shield',
      'Mega Evolution'
    ])
  })

  it('a set in another language takes the English series, never its own', () => {
    const ja = [
      set('SV1S', { id: 'SV', name: 'ポケモンカードゲーム スカーレット&バイオレット' }),
      set('M1L', { id: 'M', name: 'ポケモンカードゲーム MEGA' }),
      set('M6a', { id: 'M' })
    ]
    expect(setSeries('ja', ja, ENGLISH)).toEqual([
      'Scarlet & Violet',
      'Mega Evolution',
      'Mega Evolution'
    ])
  })

  it('a European set takes the series of the English set with its id', () => {
    const fr = [set('sv01', { id: 'sv', name: 'Écarlate et Violet' }), set('swsh1', { id: 'x' })]
    expect(setSeries('fr', fr, ENGLISH)).toEqual(['Scarlet & Violet', 'Sword & Shield'])
  })

  it('a Chinese list set matches the English series by name or alias', () => {
    const zh = [
      set('CSV5C', { id: 'Scarlet & Violet' }),
      set('CS1aC', { id: 'Sword & Shield' }),
      set('MP', { id: 'Mega' })
    ]
    expect(setSeries('zh-hans', zh, ENGLISH)).toEqual([
      'Scarlet & Violet',
      'Sword & Shield',
      'Mega Evolution'
    ])
  })

  it('is null when no English series matches', () => {
    const ja = [set('PMCG1', { id: 'PMCG', name: 'ポケットモンスターカードゲーム' }), set('x')]
    expect(setSeries('ja', ja, ENGLISH)).toEqual([null, null])
    expect(setSeries('zh-hans', [set('CSV5C', { id: 'Scarlet & Violet' })], [])).toEqual([null])
  })
})
