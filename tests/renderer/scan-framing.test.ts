import { describe, expect, it, vi } from 'vitest'
import {
  cutOffRegion,
  quadInRegion,
  readFramed,
  shiftQuad
} from '../../src/renderer/src/features/scan/vision/framing'
import type { Quad } from '../../src/renderer/src/features/scan/vision/detect'
import type { RgbaImage } from '../../src/shared/scan/types'

const quad = (x0: number, y0: number, x1: number, y1: number): Quad =>
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ] as unknown as Quad

/** A 1920x1080 webcam frame and its 810-wide centre crop. */
const FRAME_W = 1920
const FRAME_H = 1080
const CROP = { x: 555, y: 0, width: 810, height: 1080 }
const frame = (): RgbaImage => ({
  width: FRAME_W,
  height: FRAME_H,
  data: new Uint8ClampedArray(FRAME_W * FRAME_H * 4)
})

describe('cutOffRegion', () => {
  it('finds a card the crop cuts off at its right side, and the region round it', () => {
    const card = quad(1000, 200, 1600, 1000)
    const cut = cutOffRegion([card], CROP, FRAME_W, FRAME_H)
    expect(cut?.quad).toBe(card)
    // Grown by 6% of the card's size each way, within the frame.
    expect(cut?.rect).toEqual({ x: 964, y: 152, width: 672, height: 896 })
  })

  it('finds one cut off at the left side', () => {
    const card = quad(300, 100, 800, 900)
    expect(cutOffRegion([card], CROP, FRAME_W, FRAME_H)?.quad).toBe(card)
  })

  it('passes over outlines inside the crop, outside it, or barely in it', () => {
    const inside = quad(600, 100, 1200, 900)
    const outside = quad(1400, 100, 1900, 900)
    // Under a quarter of its width inside the crop.
    const barely = quad(1300, 100, 1800, 900)
    expect(cutOffRegion([inside, outside, barely], CROP, FRAME_W, FRAME_H)).toBeNull()
  })

  it('takes the likeliest outline that is cut off', () => {
    const inside = quad(600, 100, 1200, 900)
    const first = quad(1000, 200, 1600, 1000)
    const second = quad(300, 100, 800, 900)
    expect(cutOffRegion([inside, first, second], CROP, FRAME_W, FRAME_H)?.quad).toBe(first)
  })
})

describe('readFramed', () => {
  type Signals = { found: boolean; quad: Quad | null; art: { distance: number }[]; tag: string }
  const matched = (tag: string, distance: number): Signals => ({
    found: true,
    quad: quad(10, 10, 110, 160),
    art: [{ distance }],
    tag
  })

  it('reads the whole frame when there is no region', () => {
    const read = vi.fn(() => matched('whole', 30))
    const outlines = vi.fn(() => [])
    const img = frame()
    expect(readFramed(img, null, read, outlines).tag).toBe('whole')
    expect(read).toHaveBeenCalledWith(img, null)
    expect(outlines).not.toHaveBeenCalled()
  })

  it('keeps a crop that matched, its quad in whole-frame pixels, and looks no further', () => {
    const read = vi.fn((img: RgbaImage) => {
      expect(img.width).toBe(CROP.width)
      return matched('crop', 30)
    })
    const outlines = vi.fn(() => [])
    const out = readFramed(frame(), CROP, read, outlines)
    expect(out.tag).toBe('crop')
    expect(out.quad).toEqual(shiftQuad(quad(10, 10, 110, 160), CROP.x, 0))
    expect(read).toHaveBeenCalledTimes(1)
    expect(outlines).not.toHaveBeenCalled()
  })

  it('reads round a card the crop cuts off when the crop matched nothing, and keeps it when closer', () => {
    const card = quad(1000, 200, 1600, 1000)
    const read = vi.fn((img: RgbaImage, first: Quad | null) =>
      img.width === CROP.width ? matched('crop', 95) : { ...matched('cut', 70), first }
    )
    const out = readFramed(frame(), CROP, read, () => [card])
    expect(out.tag).toBe('cut')
    // The cut-off outline is tried first, in the region's pixels.
    expect((out as Signals & { first: Quad }).first).toEqual(shiftQuad(card, -964, -152))
    expect(out.quad).toEqual(shiftQuad(quad(10, 10, 110, 160), 964, 152))
  })

  it('keeps the crop when the cut-off read came no closer', () => {
    const read = vi.fn((img: RgbaImage) =>
      img.width === CROP.width ? matched('crop', 90) : matched('cut', 96)
    )
    expect(readFramed(frame(), CROP, read, () => [quad(1000, 200, 1600, 1000)]).tag).toBe('crop')
  })

  it('reads once when nothing is cut off', () => {
    const read = vi.fn(() => matched('crop', 95))
    readFramed(frame(), CROP, read, () => [quad(600, 100, 1200, 900)])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('tries the held outline first, in the crop’s pixels, and not when it lies outside', () => {
    const read = vi.fn(() => matched('crop', 30))
    readFramed(frame(), CROP, read, () => [], quad(600, 100, 1200, 900))
    expect(read).toHaveBeenLastCalledWith(expect.anything(), quad(45, 100, 645, 900))
    readFramed(frame(), CROP, read, () => [], quad(100, 100, 500, 900))
    expect(read).toHaveBeenLastCalledWith(expect.anything(), null)
  })
})

describe('quadInRegion', () => {
  it('moves a quad inside the region into its pixels, and gives null for one outside', () => {
    expect(quadInRegion(quad(600, 100, 700, 200), CROP)).toEqual(quad(45, 100, 145, 200))
    expect(quadInRegion(quad(100, 100, 700, 200), CROP)).toBeNull()
  })
})
