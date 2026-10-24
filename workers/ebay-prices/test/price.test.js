import { buildQuery, titleMatches, askingPrice } from '../src/price.js'

describe('buildQuery', () => {
  it('quotes a code that already carries a language', () => {
    expect(
      buildQuery({
        code: 'LOB-DE001',
        name: 'Blue-Eyes',
        set: 'LOB',
        rarity: 'Ultra Rare',
        lang: 'de'
      })
    ).toBe('"LOB-DE001" Ultra Rare')
  })

  it('adds the language word when the code has none', () => {
    expect(
      buildQuery({
        code: 'LB-05',
        name: 'Dark Magician',
        set: 'Vol.1',
        rarity: 'Ultra Rare',
        lang: 'ja'
      })
    ).toBe('"LB-05" Japanese Ultra Rare')
  })

  it('uses name, set and language word when there is no code', () => {
    expect(
      buildQuery({
        code: '',
        name: 'Dark Magician',
        set: 'Vol.1',
        rarity: 'Ultra Rare',
        lang: 'ja'
      })
    ).toBe('"Dark Magician" Vol.1 Japanese Ultra Rare')
  })

  it('omits an empty rarity', () => {
    expect(buildQuery({ code: 'LOB-DE001', name: 'x', set: 's', rarity: '', lang: 'de' })).toBe(
      '"LOB-DE001"'
    )
  })
})

describe('titleMatches', () => {
  it('is case-insensitive and prefers the code', () => {
    expect(titleMatches('yugioh lob-de001 holo', { code: 'LOB-DE001', name: 'Blue-Eyes' })).toBe(
      true
    )
    expect(titleMatches('Blue-Eyes White Dragon', { code: 'LOB-DE001', name: 'Blue-Eyes' })).toBe(
      false
    )
  })

  it('falls back to the name without a code', () => {
    expect(titleMatches('DARK MAGICIAN vol.1', { code: '', name: 'Dark Magician' })).toBe(true)
    expect(titleMatches('Red-Eyes', { code: '', name: 'Dark Magician' })).toBe(false)
  })
})

describe('askingPrice', () => {
  it('drops outliers and takes the median', () => {
    expect(askingPrice([10, 11, 12, 100])).toEqual({ price: 11, listingCount: 3 })
  })
  it('needs at least two listings', () => {
    expect(askingPrice([5])).toEqual({ price: null, listingCount: 1 })
    expect(askingPrice([])).toEqual({ price: null, listingCount: 0 })
  })
  it('rounds to cents', () => {
    expect(askingPrice([1.001, 1.004]).price).toBe(1)
  })
})
