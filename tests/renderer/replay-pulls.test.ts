import { describe, it, expect } from 'vitest'
import { pickReplayPulls, replayHeader } from '@/features/scan/replay/pulls'
import { formatUsd } from '@/lib/format'
import { replayRow as row } from './replayRows'

describe('pickReplayPulls', () => {
  it('keeps pulls at $1.00 and up, drops $0.99, unpriced and guesses', () => {
    const rows = [
      row(0.99, { name: 'cheap' }),
      row(1, { name: 'dollar' }),
      row(null, { name: 'unpriced' }),
      row(5, { name: 'guess', guess: true }),
      row(3, { name: 'three' })
    ]
    expect(pickReplayPulls(rows).map((p) => p.name)).toEqual(['dollar', 'three'])
  })

  it('keeps the 8 dearest of 10, cheapest first', () => {
    const rows = [5, 1, 9, 3, 10, 2, 7, 4, 8, 6].map((p) => row(p))
    expect(pickReplayPulls(rows).map((p) => p.price)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('breaks a price tie by pull order', () => {
    const rows = [
      row(5, { name: 'later', addedAt: 200 }),
      row(5, { name: 'earlier', addedAt: 100 })
    ]
    expect(pickReplayPulls(rows).map((p) => p.name)).toEqual(['earlier', 'later'])
  })

  it('one entry per row with its quantity', () => {
    const pulls = pickReplayPulls([row(2, { quantity: 3 })])
    expect(pulls).toHaveLength(1)
    expect(pulls[0]).toMatchObject({ quantity: 3, price: 2 })
  })

  it('uses the printed rarity when the printing has one', () => {
    const r = row(40, { rarity: 'Holo' })
    r.options[0].printedRarity = 'Special Illustration Rare'
    expect(pickReplayPulls([r])[0].rarity).toBe('Special Illustration Rare')
    expect(pickReplayPulls([row(40, { rarity: 'Starlight Rare' })])[0].rarity).toBe(
      'Starlight Rare'
    )
  })

  it('empty list gives no pulls', () => {
    expect(pickReplayPulls([])).toEqual([])
  })
})

describe('replayHeader', () => {
  it("names the newest row's date, cards and value", () => {
    const newest = new Date(2026, 10, 4, 21, 30).getTime()
    const rows = [
      row(10, { addedAt: new Date(2026, 10, 3, 20).getTime() }),
      row(5, { quantity: 2, addedAt: newest })
    ]
    expect(replayHeader(rows)).toBe(`Nov 4 · 3 cards · ${formatUsd(20)}`)
  })
})
