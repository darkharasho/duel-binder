import {
  buildQuery,
  titleMatches,
  isSingleCard,
  namesOtherRarity,
  namesLongerRarity,
  askingPrice
} from '../src/price.js'

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

describe('isSingleCard', () => {
  it('rejects slabs, lots and proxies', () => {
    for (const t of [
      'PSA 10 LOB-JP001',
      'BGS 9.5 Blue-Eyes',
      'Lot of 5 LB-01',
      'LB-01 Orica proxy'
    ]) {
      expect(isSingleCard(t)).toBe(false)
    }
    expect(isSingleCard('LB-01 Blue-Eyes White Dragon Ultra Rare NM')).toBe(true)
  })

  it('rejects listings of several copies', () => {
    for (const t of [
      '3x Cyber Dragon GFP2-EN178 Ghost Rare PLAYSET',
      'Cyber Dragon 2x GFP2-EN178',
      'Ash Blossom x3 RA01-EN008',
      '3 x Ash Blossom RA01-EN008',
      'Ash Blossom RA01-EN008 Playset',
      'Set of 3 Ash Blossom RA01-EN008',
      'Ash Blossom RA01-EN008 - 2 copies'
    ]) {
      expect(isSingleCard(t), t).toBe(false)
    }
    for (const t of [
      'Number 39: Utopia LC01-EN039 1st Edition',
      'Dragon Master Knight DRLG-EN001 x1',
      'LOB-EN001 1x Blue-Eyes'
    ]) {
      expect(isSingleCard(t), t).toBe(true)
    }
  })
})

describe('namesOtherRarity', () => {
  it('flags a rarity the request does not contain', () => {
    expect(namesOtherRarity('SDK-001 Secret Rare', 'Common')).toBe(true)
    expect(namesOtherRarity('SDK-001 Prismatic Secret Rare', 'Secret Rare')).toBe(true)
    expect(namesOtherRarity('SDK-001 Super Rare', 'Rare')).toBe(true)
  })

  it('allows the same rarity or none named', () => {
    expect(namesOtherRarity('SDK-001 ULTRA RARE', 'Ultra Rare')).toBe(false)
    expect(namesOtherRarity('SDK-001 Prismatic Secret Rare', 'Prismatic Secret Rare')).toBe(false)
    expect(namesOtherRarity('SDK-001 Blue-Eyes NM', 'Common')).toBe(false)
  })
})

describe('namesLongerRarity', () => {
  const qc = 'Pot of Prosperity RC04-JP067 Quarter Century Secret Rare'
  it('flags a longer rarity that contains the requested one', () => {
    expect(namesLongerRarity(qc, 'Secret Rare')).toBe(true)
    expect(namesLongerRarity('RC04-JP067 Extra Secret Rare', 'Secret Rare')).toBe(true)
    expect(namesLongerRarity('SDK-001 Ultra Rare', 'Rare')).toBe(true)
  })
  it('allows the same rarity or an unrelated one', () => {
    expect(namesLongerRarity(qc, '')).toBe(false)
    expect(namesLongerRarity(qc, 'Quarter Century Secret Rare')).toBe(false)
    expect(namesLongerRarity('Pot of Prosperity RC04-JP067 Secret Rare', 'Secret Rare')).toBe(false)
    expect(namesLongerRarity('SDK-001 Ultra Rare', 'Secret Rare')).toBe(false)
  })
})
