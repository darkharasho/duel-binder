import { describe, expect, it } from 'vitest'
import {
  FRAMING_SWITCH_AFTER,
  framing,
  quadInRegion,
  shiftQuad
} from '../../src/renderer/src/features/scan/vision/framing'
import type { Quad } from '../../src/renderer/src/features/scan/vision/detect'

describe('framing', () => {
  it('reads the crop until it misses FRAMING_SWITCH_AFTER frames in a row, then the whole frame', () => {
    const f = framing()
    for (let i = 1; i < FRAMING_SWITCH_AFTER; i++) {
      f.record(false)
      expect(f.whole()).toBe(false)
    }
    f.record(true)
    // A match starts the count over.
    for (let i = 1; i < FRAMING_SWITCH_AFTER; i++) f.record(false)
    expect(f.whole()).toBe(false)
    f.record(false)
    expect(f.whole()).toBe(true)
  })

  it('keeps the whole frame while it matches, and goes back to the crop when it keeps missing', () => {
    const f = framing(2)
    f.record(false)
    f.record(false)
    expect(f.whole()).toBe(true)
    f.record(true)
    f.record(false)
    f.record(true)
    expect(f.whole()).toBe(true)
    f.record(false)
    f.record(false)
    expect(f.whole()).toBe(false)
    f.record(false)
    f.record(false)
    f.reset()
    expect(f.whole()).toBe(false)
  })
})

describe('quads across the crop', () => {
  const quad: Quad = [
    [600, 100],
    [900, 100],
    [900, 500],
    [600, 500]
  ]
  const region = { x: 555, y: 0, width: 810, height: 1080 }

  it('moves a quad into the crop and back', () => {
    const inside = quadInRegion(quad, region)!
    expect(inside[0]).toEqual([45, 100])
    expect(shiftQuad(inside, region.x, region.y)).toEqual(quad)
  })

  it('has no quad in the crop for one partly outside it', () => {
    const right = shiftQuad(quad, 600, 0)
    expect(quadInRegion(right, region)).toBeNull()
  })
})
