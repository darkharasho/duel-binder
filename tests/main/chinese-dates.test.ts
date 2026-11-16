import { describe, expect, it } from 'vitest'
import { chineseSetDates } from '../../scripts/catalog/pokemon/chineseDates'

const entry = (id: string, code = id) => ({ id, code, series: 'S', count: 1 })

describe('chineseSetDates', () => {
  const known = { NEW: '2026-07-01', MID: '2026-03-01', OLD: '2025-01-01', LATE: '2026-09-01' }
  // The index runs newest first, with a late set tacked on at the end, as the real one does.
  const index = [
    entry('TOP'),
    entry('NEW'),
    entry('DECK'),
    entry('MID'),
    entry('PROMO'),
    entry('BOX'),
    entry('OLD'),
    entry('STARTER'),
    entry('LATE'),
    entry('W-1', 'W'),
    entry('W-2', 'W')
  ]
  const dates = chineseSetDates(index, known)

  it('keeps a known date', () => {
    expect(dates.get('MID')).toBe('2026-03-01')
    expect(dates.get('LATE')).toBe('2026-09-01')
  })

  it('gives an undated set the date of the set just older than it in the list', () => {
    expect(dates.get('DECK')).toBe('2026-03-01')
    expect(dates.get('BOX')).toBe('2025-01-01')
    expect(dates.get('TOP')).toBe('2026-07-01') // nothing newer: the older neighbour
  })

  it('takes the earlier neighbour where the index is out of order at its end', () => {
    // STARTER sits between OLD (2025) and the late set (2026-09): it's OLD's.
    expect(dates.get('STARTER')).toBe('2025-01-01')
  })

  it('counts waves sharing a code as their one set, and skips promo rows', () => {
    expect(dates.get('W')).toBe('2026-09-01')
    expect(dates.has('PROMO')).toBe(false)
  })

  it('keeps a known date for a set not in the index (promos)', () => {
    expect(chineseSetDates([], { P: '2026-09-16' }).get('P')).toBe('2026-09-16')
  })
})
