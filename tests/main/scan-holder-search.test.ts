// @vitest-environment node
// The holder search's geometry: which regions of a frame are searched again, and how a quad found
// in one maps back to the frame.
import { describe, expect, it } from 'vitest'
import {
  MAX_REGIONS,
  centreRegion,
  fromRegion,
  overlap,
  pickRegions,
  regionAround,
  type Rect
} from '../../src/renderer/src/features/scan/vision/holderSearch'
import type { Quad } from '../../src/renderer/src/features/scan/vision/detect'

const quad = (x0: number, y0: number, x1: number, y1: number): Quad => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
]

describe('regionAround', () => {
  it("is the quad's bounding box grown by the margin on every side", () => {
    expect(regionAround(quad(100, 200, 300, 500), 0.1, 1920, 1080)).toEqual({
      x0: 80,
      y0: 170,
      x1: 320,
      y1: 530
    })
  })

  it('bounds a slanted quad by its corners', () => {
    const slanted: Quad = [
      [150, 100],
      [300, 140],
      [260, 400],
      [110, 360]
    ]
    expect(regionAround(slanted, 0, 1920, 1080)).toEqual({ x0: 110, y0: 100, x1: 300, y1: 400 })
  })

  it('stays inside the frame', () => {
    expect(regionAround(quad(-40, -10, 700, 400), 0.1, 640, 360)).toEqual({
      x0: 0,
      y0: 0,
      x1: 640,
      y1: 360
    })
  })

  it('is null for a quad wholly outside the frame', () => {
    expect(regionAround(quad(700, 10, 800, 100), 0, 640, 360)).toBeNull()
  })
})

describe('overlap', () => {
  const a: Rect = { x0: 0, y0: 0, x1: 100, y1: 100 }
  it('is 1 for the same rectangle and 0 for ones apart', () => {
    expect(overlap(a, a)).toBe(1)
    expect(overlap(a, { x0: 100, y0: 0, x1: 200, y1: 100 })).toBe(0)
  })

  it('is intersection over union', () => {
    // Half of each: 5000 over 15000.
    expect(overlap(a, { x0: 50, y0: 0, x1: 150, y1: 100 })).toBeCloseTo(1 / 3)
  })
})

describe('pickRegions', () => {
  const r = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 })

  it('keeps regions in order, at most MAX_REGIONS', () => {
    const many = [0, 1, 2, 3, 4].map((i) => r(i * 200, 0, i * 200 + 150, 150))
    expect(pickRegions(many)).toEqual(many.slice(0, MAX_REGIONS))
  })

  it('leaves out one much the same as a region kept, and nulls', () => {
    const first = r(0, 0, 400, 600)
    const nearlyFirst = r(10, 10, 410, 590)
    const other = r(500, 0, 900, 600)
    expect(pickRegions([first, null, nearlyFirst, other])).toEqual([first, other])
  })

  it('leaves out regions too small to search again', () => {
    const tiny = r(0, 0, 30, 400)
    const fine = r(100, 0, 400, 400)
    expect(pickRegions([tiny, fine], 3, 40)).toEqual([fine])
  })
})

describe('fromRegion', () => {
  it("maps a quad found in a region scaled up back into the frame's pixels", () => {
    const region: Rect = { x0: 600, y0: 200, x1: 920, y1: 680 }
    // The region's longer side (480 px) searched at 640: scale 4/3.
    const found = quad(40, 80, 400, 560)
    expect(fromRegion(found, region, 4 / 3)).toEqual(quad(630, 260, 900, 620))
  })
})

describe('centreRegion', () => {
  it('is the middle 60% across and 90% down', () => {
    expect(centreRegion(1920, 1080)).toEqual({ x0: 384, y0: 54, x1: 1536, y1: 1026 })
  })
})
