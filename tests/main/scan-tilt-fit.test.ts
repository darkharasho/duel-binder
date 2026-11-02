import { describe, expect, it } from 'vitest'
import {
  fitModel,
  fitPair,
  heldOut,
  windowFrames,
  type TiltRow
} from '../../scripts/scan/rarity/tiltFit'

/** Each row its own card, at its class's centre plus a small seeded jitter. */
function toy(centres: Record<string, number[]>, perClass: number): TiltRow[] {
  let seed = 7
  const jitter = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed / 2147483647 - 0.5) * 0.4
  }
  const rows: TiltRow[] = []
  for (const [finish, centre] of Object.entries(centres)) {
    for (let i = 0; i < perClass; i++) {
      rows.push({ card: `${finish}-${i}`, finish, x: centre.map((v) => v + jitter()) })
    }
  }
  return rows
}

describe('tilt fit', () => {
  it('a pair reads the feature that separates it', () => {
    const rows = toy({ 'Super Rare': [0, 5], 'Ultra Rare': [3, 5] }, 6) // feature 0 separates, 1 doesn't
    expect(fitPair(rows, 'Super Rare', 'Ultra Rare', 1).use).toEqual([0])
  })

  it('leaves out a class with too few clips or cards', () => {
    const m = fitModel([...toy({ A: [0], B: [3] }, 10), ...toy({ C: [6] }, 3)], 1)
    expect(m.classes).toEqual(['A', 'B'])
    expect(m.pairs).toHaveLength(1)
  })

  it('counts clips, not windows, when rows name their clip', () => {
    // Ten windows of one clip of one card are one clip.
    const one = Array.from({ length: 10 }, (_, i) => ({
      card: 'c',
      clip: 'k',
      finish: 'C',
      x: [6 + i * 0.01]
    }))
    const m = fitModel([...toy({ A: [0], B: [3] }, 10), ...one], 1)
    expect(m.classes).toEqual(['A', 'B'])
  })

  it('held out by card, a separable toy scores every row right', () => {
    const rows = toy({ A: [0], B: [3] }, 8)
    expect(heldOut(rows, rows, ['A', 'B'], 1)).toEqual({ right: 16, total: 16 })
  })

  it('samples the runtime grid from 15 fps frames, ties to the earlier frame', () => {
    // grid 0,100,...,500 (end exclusive); frame n is at n * 66.7 ms
    expect(windowFrames([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 15, 0, 600, 100)).toEqual([
      0, 1, 3, 4, 6, 7
    ])
  })

  it('skips a grid time with no frame within half a step', () => {
    // frame 3 (200 ms) was not straightened
    expect(windowFrames([0, 1, 2, 4, 5, 6, 7, 8, 9], 15, 0, 600, 100)).toEqual([0, 1, 4, 6, 7])
  })
})
