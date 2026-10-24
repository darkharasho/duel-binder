import { pickDefaultCode, setNumber, setPrefix } from '@shared/sets'

test('setNumber', () => {
  expect(setNumber('MRD-003')).toEqual({ number: 3, label: '003' })
  expect(setNumber('MRD-E003')).toEqual({ number: 3, label: '003' })
  expect(setNumber('LOB-EN005')).toEqual({ number: 5, label: '005' })
  expect(setNumber('YAP1-EN001')).toEqual({ number: 1, label: '001' })
  expect(setNumber('DUSA-EN001A')).toEqual({ number: 1, label: '001' })
  expect(setNumber('SDY-E')).toEqual({ number: null, label: '' })
  expect(setNumber('PROMO')).toEqual({ number: null, label: '' })
})

test('setPrefix', () => {
  expect(setPrefix('MRD-E003')).toBe('MRD')
  expect(setPrefix('PROMO')).toBe('PROMO')
})

test('pickDefaultCode prefers regionless, then -EN, then first', () => {
  const c = (setCode: string, owned = 0): { setCode: string; owned: number } => ({ setCode, owned })
  expect(pickDefaultCode([c('MRD-003'), c('MRD-E003'), c('MRD-EN003')])).toBe(0)
  expect(pickDefaultCode([c('MRD-E010'), c('MRD-EN010')])).toBe(1)
  expect(pickDefaultCode([c('MRD-E010'), c('MRD-G010')])).toBe(0)
  expect(pickDefaultCode([c('MRD-003'), c('MRD-E003', 2)])).toBe(1) // an owned code wins
  expect(pickDefaultCode([c('MRD-003', 1), c('MRD-E003', 2), c('X-EN1')])).toBe(0) // rule applies within owned
  expect(pickDefaultCode([c('SDY-E')])).toBe(0)
})
