import { describe, expect, it } from 'vitest'
import { projectMonthly, type CostTotals } from '../../src/shared/costs'

const zero: CostTotals = { requests: 0, rowsRead: 0, rowsWritten: 0, ms: 0 }

describe('projectMonthly', () => {
  it('is only the plan fee while everything fits the included amounts', () => {
    const p = projectMonthly(
      {
        perUser: { requests: 3000, rowsRead: 1e6, rowsWritten: 1e4, ms: 60_000 },
        system: zero,
        storageBytes: 1e9
      },
      100
    )
    expect(p.users).toBe(100)
    expect(p.dollars).toBe(5)
    expect(p.lines.find((l) => l.item === 'Workers Paid plan')?.dollars).toBe(5)
    expect(
      p.lines.filter((l) => l.item !== 'Workers Paid plan').every((l) => l.dollars === 0)
    ).toBe(true)
  })

  it('charges what goes past each included amount at its rate', () => {
    const p = projectMonthly(
      {
        perUser: { requests: 3000, rowsRead: 20e6, rowsWritten: 20_000, ms: 0 },
        system: { requests: 0, rowsRead: 0, rowsWritten: 10e6, ms: 0 },
        storageBytes: 10e9
      },
      5000
    )
    const line = (item: string): number => p.lines.find((l) => l.item === item)!.dollars
    // 100 billion read, 25 billion included, $0.001 a million.
    expect(line('Rows read')).toBeCloseTo(75)
    // 110 million written, 50 million included, $1 a million.
    expect(line('Rows written')).toBeCloseTo(60)
    // 15 million requests: Workers include 10 million ($0.30/M), Durable Objects 1 million ($0.15/M).
    expect(line('Worker requests')).toBeCloseTo(1.5)
    expect(line('Database requests')).toBeCloseTo(2.1)
    // 10 GB stored, 5 included, $0.20 a GB.
    expect(line('Database storage')).toBeCloseTo(1)
    expect(p.dollars).toBeCloseTo(5 + 75 + 60 + 1.5 + 2.1 + 1)
  })

  it('counts database time as 128 MB for each second a request takes', () => {
    // 1,000 users × 5,000 s = 5 million s × 0.128 GB = 640,000 GB-s; 400,000 included; $12.50 a million.
    const p = projectMonthly(
      { perUser: { ...zero, ms: 5_000_000 }, system: zero, storageBytes: null },
      1000
    )
    const time = p.lines.find((l) => l.item === 'Database time')!
    expect(time.usage).toBeCloseTo(640_000)
    expect(time.dollars).toBeCloseTo(3)
  })

  it('projects only the system work when there are no measured users yet', () => {
    const p = projectMonthly(
      { perUser: null, system: { ...zero, rowsWritten: 60e6 }, storageBytes: null },
      500
    )
    expect(p.lines.find((l) => l.item === 'Rows written')!.dollars).toBeCloseTo(10)
  })
})
