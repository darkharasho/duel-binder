// Which outlines get nudged onto the card when nothing matched (candidates.ts nudgeStarts).
import { describe, expect, it, vi } from 'vitest'
import type { Quad } from '../../src/renderer/src/features/scan/vision/detect'

vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('../../vendor/opencv/opencv.js') }
})
const { nudgeStarts } = await import('../../src/renderer/src/features/scan/vision/candidates')

/** A card-shaped quad w wide at (x, y), corners clockwise from top-left. */
const box = (x: number, y: number, w: number): Quad => {
  const h = w / 0.716
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h]
  ]
}

describe('nudgeStarts', () => {
  // A borderless Magic card held over a stack: its art's card-shaped panes are outlined first,
  // and the card's own outline, cut short where it meets the fingers, matches nothing until moved.
  const pane = box(100, 100, 120)
  const panes = [0, 1, 2, 3].map((i) => ({ quad: box(100 + i * 4, 100, 120), distance: 84 + i }))
  const card = { quad: box(90, 90, 220), distance: 92 }

  it('nudges the closest few outlines', () => {
    const { closest } = nudgeStarts([...panes, card])
    expect(closest.map((s) => s.distance)).toEqual([84, 85, 86])
  })

  it('also nudges the largest outline, far as its art is, when it is well over the first', () => {
    expect(nudgeStarts([...panes, card]).outer).toBe(card)
  })

  it('nudges no larger outline that does not hold the first', () => {
    const beside = { quad: box(400, 100, 220), distance: 92 }
    expect(nudgeStarts([...panes, beside]).outer).toBeNull()
  })

  it('takes the largest of the outlines that hold the first', () => {
    const beside = { quad: box(400, 100, 400), distance: 92 }
    expect(nudgeStarts([...panes, card, beside]).outer).toBe(card)
  })

  it('nudges no larger outline when none is well over the first', () => {
    const near = { quad: box(98, 98, 130), distance: 95 }
    expect(nudgeStarts([{ quad: pane, distance: 84 }, near]).outer).toBeNull()
  })

  it('nudges the largest only once when it is among the closest already', () => {
    const close = { ...card, distance: 70 }
    const { closest, outer } = nudgeStarts([...panes, close])
    expect(closest[0]).toBe(close)
    expect(outer).toBeNull()
  })

  it('has nothing to nudge in a frame with no outlines', () => {
    expect(nudgeStarts([])).toEqual({ closest: [], outer: null })
  })
})
