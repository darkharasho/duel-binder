import { sweepKey, parseListing, setPrices } from '../src/set.js'

const item = (title, value, currency = 'USD') => ({
  title,
  price: { value: String(value), currency }
})

describe('sweepKey', () => {
  it('strips the number', () => {
    expect(sweepKey('CORI-JP025')).toBe('CORI-JP')
    expect(sweepKey('LOB-K001')).toBe('LOB-K')
  })
})

describe('parseListing', () => {
  it('reads code and short rarity', () => {
    expect(parseListing('Yugioh CORI-JP025 Rayrage UR Japanese', 'CORI-JP')).toEqual({
      code: 'CORI-JP025',
      rarity: 'Ultra Rare'
    })
  })

  it('prefers the longest rarity', () => {
    expect(parseListing('CORI-JP001 QCSE Quarter Century Secret', 'CORI-JP').rarity).toBe(
      'Quarter Century Secret Rare'
    )
    expect(parseListing('cori-jp001 Quarter Century Secret Rare', 'CORI-JP')).toEqual({
      code: 'CORI-JP001',
      rarity: 'Quarter Century Secret Rare'
    })
  })

  it('gives null on conflicting rarities', () => {
    expect(parseListing('CORI-JP001 UR SE', 'CORI-JP').rarity).toBeNull()
  })

  it('does not read R inside words', () => {
    expect(parseListing('CORI-JP010 Rescue Rabbit', 'CORI-JP').rarity).toBeNull()
  })

  it("leaves Rock 'n' Roll, Link-R and Normal Monster without a rarity", () => {
    expect(parseListing("CORI-JP010 Rock 'n' Roll", 'CORI-JP').rarity).toBeNull()
    expect(parseListing('CORI-JP010 Link-R', 'CORI-JP').rarity).toBeNull()
    expect(parseListing('CORI-JP010 Normal Monster', 'CORI-JP').rarity).toBeNull()
  })

  it('prefers the longest spelled-out name', () => {
    expect(parseListing('CORI-JP001 Prismatic Secret Rare', 'CORI-JP').rarity).toBe(
      'Prismatic Secret Rare'
    )
    expect(parseListing('CORI-JP001 Ultra Parallel Rare', 'CORI-JP').rarity).toBe(
      'Ultra Parallel Rare'
    )
  })

  it('reads the newer spelled-out names', () => {
    expect(parseListing('RC04-JP021 Extra Secret Rare', 'RC04-JP').rarity).toBe('Extra Secret Rare')
    expect(parseListing('RC04-JP021 Rare Parallel Rare', 'RC04-JP').rarity).toBe(
      'Rare Parallel Rare'
    )
    expect(parseListing('RC04-JP021 Super Short Print', 'RC04-JP').rarity).toBe('Super Short Print')
    expect(parseListing('RC04-JP021 Short Print', 'RC04-JP').rarity).toBe('Short Print')
  })

  it('gives a null code when the key is absent', () => {
    expect(parseListing('Blue-Eyes White Dragon', 'CORI-JP')).toEqual({ code: null, rarity: null })
  })
})

describe('setPrices', () => {
  it('leaves rarity-less listings off multi-rarity codes', () => {
    const { codes } = setPrices(
      [
        item('CORI-JP001 UR', 10),
        item('CORI-JP001 UR', 12),
        item('CORI-JP001 SE', 30),
        item('CORI-JP001 SE', 34),
        item('CORI-JP001 Rayrage', 20)
      ],
      'CORI-JP'
    )
    expect(codes['CORI-JP001'].byRarity['Ultra Rare'].price).toBe(11)
    expect(codes['CORI-JP001'].byRarity['Secret Rare'].price).toBe(32)
    expect(codes['CORI-JP001'].all.listingCount).toBe(5)
  })

  it('drops lots and non-USD', () => {
    const { codes } = setPrices(
      [
        item('CORI-JP002 UR', 10),
        item('CORI-JP002 UR', 12),
        item('CORI-JP002 UR lot of cards', 5),
        item('CORI-JP002 UR', 900, 'JPY')
      ],
      'CORI-JP'
    )
    expect(codes['CORI-JP002'].all).toEqual({ price: 11, listingCount: 2 })
  })
})
