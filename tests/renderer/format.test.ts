import { formatMonthYear, formatRelative, formatUsd } from '@/lib/format'

describe('formatUsd', () => {
  it('formats null as a dash', () => expect(formatUsd(null)).toBe('—'))
  it('formats dollars with grouping', () => {
    expect(formatUsd(1234.56)).toBe('$1,234.56')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(5)).toBe('$5.00')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-10-23T12:00:00Z')
  const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString()
  it('null is never', () => expect(formatRelative(null, now)).toBe('never'))
  it('under a minute is just now', () => expect(formatRelative(ago(59_000), now)).toBe('just now'))
  it('minutes', () => expect(formatRelative(ago(5 * 60_000), now)).toBe('5 min ago'))
  it('hours', () => expect(formatRelative(ago(3 * 3_600_000), now)).toBe('3 h ago'))
  it('days', () => expect(formatRelative(ago(2 * 86_400_000), now)).toBe('2 days ago'))
})

it('formatMonthYear shows month and year, and passes through junk', () => {
  expect(formatMonthYear('2002-06-26')).toBe('Jun 2002')
  expect(formatMonthYear('2002-01-01')).toBe('Jan 2002')
  expect(formatMonthYear('soon')).toBe('soon')
})
