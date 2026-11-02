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
  it("takes TCGdex's own name, in the set's language", () => {
    const ja = [set('SV1S', { id: 'SV', name: 'ポケモンカードゲーム スカーレット&バイオレット' })]
    expect(setSeries(ja, ENGLISH)).toEqual(['ポケモンカードゲーム スカーレット&バイオレット'])
  })

  it('a set built with only an id takes the name another set of its language gives that id', () => {
    const ja = [set('M6a', { id: 'M' }), set('M1L', { id: 'M', name: 'ポケモンカードゲーム MEGA' })]
    expect(setSeries(ja, ENGLISH)).toEqual([
      'ポケモンカードゲーム MEGA',
      'ポケモンカードゲーム MEGA'
    ])
    expect(setSeries([set('me06', { id: 'me' }), ...ENGLISH], ENGLISH)[0]).toBe('Mega Evolution')
  })

  it('falls back to the English series of the same id, alias or name', () => {
    const zh = [
      set('CSV5C', { id: 'Scarlet & Violet' }),
      set('CS1aC', { id: 'Sword & Shield' }),
      set('MP', { id: 'Mega' }),
      set('dex', { id: 'swsh' }),
      set('ja', { id: 'M' })
    ]
    expect(setSeries(zh, ENGLISH)).toEqual([
      'Scarlet & Violet',
      'Sword & Shield',
      'Mega Evolution',
      'Sword & Shield',
      'Mega Evolution'
    ])
  })

  it('is null when nothing names it', () => {
    expect(setSeries([set('PR', { id: 'PROMO' }), set('x')], ENGLISH)).toEqual([null, null])
    expect(setSeries([set('CSV5C', { id: 'Scarlet & Violet' })], [])).toEqual([null])
  })
})
