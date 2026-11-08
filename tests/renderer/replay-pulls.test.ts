import { describe, it, expect } from 'vitest'
import {
  choosePulls,
  pickReplayPulls,
  replayHeader,
  replaySourceOfRows,
  type PullCandidate
} from '@/features/scan/replay/pulls'
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

  it('an unpriced chase rarity makes the replay; a version still to pick does not', () => {
    const open = row(null, {
      name: 'open',
      game: 'pkm',
      flag: 'pick-printing',
      rarity: 'Ultra Rare'
    })
    const rows = [row(null, { name: 'ur', game: 'pkm', rarity: 'Ultra Rare' }), open]
    expect(pickReplayPulls(rows).map((p) => p.name)).toEqual(['ur'])
    expect(pickReplayPulls(rows)[0].price).toBeNull()
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

const cand = (price: number | null, o: Partial<PullCandidate> = {}): PullCandidate => ({
  key: `k${price}-${o.name ?? ''}`,
  name: 'c',
  imageId: 1,
  photoId: null,
  rarity: null,
  setCode: null,
  price,
  quantity: 1,
  addedAt: 1,
  guess: false,
  ...o
})

describe('choosePulls', () => {
  it('drops a guess and a $0.99 candidate', () => {
    const out = choosePulls([cand(5, { guess: true }), cand(0.99), cand(2)])
    expect(out.map((p) => p.price)).toEqual([2])
  })

  it('keeps the dearest 8 of 10 in play order', () => {
    const out = choosePulls([5, 1, 9, 3, 10, 2, 7, 4, 8, 6].map((p) => cand(p)))
    expect(out.map((p) => p.price)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('fills spare places with chase rarities that have no price, or under $1, before the priced', () => {
    const out = choosePulls(
      [
        cand(null, { name: 'starlight', rarity: 'Starlight Rare', addedAt: 3 }),
        cand(0.5, { name: 'secret', rarity: 'Secret Rare', addedAt: 1 }),
        cand(null, { name: 'ultra', rarity: 'Ultra Rare' }),
        cand(null, { name: 'guess', rarity: 'Starlight Rare', guess: true }),
        cand(4, { name: 'four' })
      ],
      'ygo'
    )
    // The top rarity plays nearer the priced pulls; the dearest still comes last.
    expect(out.map((p) => p.name)).toEqual(['secret', 'starlight', 'four'])
  })

  it('a rarity pull only takes a place no priced pull wants', () => {
    const priced = Array.from({ length: 8 }, (_, i) => cand(i + 1))
    const rare = cand(null, { name: 'rare', rarity: 'Starlight Rare' })
    expect(choosePulls([...priced, rare], 'ygo').map((p) => p.name)).not.toContain('rare')
    const seven = choosePulls([...priced.slice(1), rare], 'ygo')
    expect(seven).toHaveLength(8)
    expect(seven[0].name).toBe('rare')
  })

  it('the top rarities win the spare places, then the earliest pulled', () => {
    const priced = Array.from({ length: 6 }, (_, i) => cand(i + 1))
    const out = choosePulls(
      [
        ...priced,
        cand(null, { name: 'ex late', rarity: 'Double Rare', addedAt: 9 }),
        cand(null, { name: 'ex early', rarity: 'Double Rare', addedAt: 2 }),
        cand(null, { name: 'sir', rarity: 'Special Illustration Rare', addedAt: 5 })
      ],
      'pkm'
    )
    expect(out.slice(0, 2).map((p) => p.name)).toEqual(['ex early', 'sir'])
  })
})

describe('replaySourceOfRows', () => {
  it('pairs the picked pulls with the header', () => {
    const rows = [row(5), row(0.5)]
    expect(replaySourceOfRows(rows)).toEqual({
      pulls: pickReplayPulls(rows),
      header: replayHeader(rows)
    })
    expect(replaySourceOfRows(rows).header).toBe(replayHeader(rows))
  })
})
