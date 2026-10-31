import { describe, expect, it } from 'vitest'
import { sameSpot } from '../../src/renderer/src/features/scan/sameSpot'
import type { Quad } from '../../src/renderer/src/features/scan/vision/detect'

const card = (x: number, y: number, w = 700, h = 980): Quad => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h]
]

describe('sameSpot', () => {
  it('holds a card jittering in the hand', () => {
    expect(sameSpot(card(100, 100), card(130, 90))).toBe(true)
  })

  it('holds a card whose outline grew to its toploader', () => {
    expect(sameSpot(card(100, 100), card(50, 40, 800, 1100))).toBe(true)
  })

  it('takes a card moved half its width away for another', () => {
    expect(sameSpot(card(100, 100), card(600, 100))).toBe(false)
  })

  it('knows nothing without both outlines', () => {
    expect(sameSpot(null, card(0, 0))).toBe(false)
    expect(sameSpot(card(0, 0), null)).toBe(false)
  })
})
