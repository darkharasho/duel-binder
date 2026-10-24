import { parsePrice, priceFor } from '@shared/pricing'

test('parsePrice', () => {
  expect(parsePrice('5.12')).toBe(5.12)
  for (const bad of ['0.00', '', 'N/A', undefined, null, '-1', 'NaN'])
    expect(parsePrice(bad)).toBeNull()
})

test('parsePrice accepts numbers and rejects non-positive or non-finite numbers', () => {
  expect(parsePrice(7.5)).toBe(7.5)
  for (const bad of [0, -2, NaN, Infinity]) expect(parsePrice(bad)).toBeNull()
})

test('priceFor prefers set price', () =>
  expect(priceFor(5.12, 7.5)).toEqual({ unitPrice: 5.12, approximate: false }))
test('priceFor falls back to tcgplayer', () =>
  expect(priceFor(null, 7.5)).toEqual({ unitPrice: 7.5, approximate: true }))
test('priceFor with nothing', () =>
  expect(priceFor(null, null)).toEqual({ unitPrice: null, approximate: true }))
test('priceFor treats a zero or NaN set price as missing', () => {
  expect(priceFor(0, 7.5)).toEqual({ unitPrice: 7.5, approximate: true })
  expect(priceFor(NaN, null)).toEqual({ unitPrice: null, approximate: true })
})
