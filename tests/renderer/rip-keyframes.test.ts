import { describe, expect, it } from 'vitest'
import {
  KeyframePicker,
  type Pick,
  motion,
  sharpness,
  toGrey
} from '../../src/renderer/src/features/admin/keyframes'
import { blockLook, lookDiff, SAME_CARD } from '../../src/renderer/src/features/admin/cardLook'
import type { RgbaImage } from '../../src/shared/scan/types'

const W = 32
const H = 18

/** A flat image with a bright square at x (a "card"); `noise` adds fine detail for sharpness. */
function scene(x: number, detail = false): Uint8Array {
  const g = new Uint8Array(W * H).fill(40)
  for (let y = 4; y < 14; y++)
    for (let i = x; i < x + 8 && i < W; i++) g[y * W + i] = detail && (i + y) % 2 ? 210 : 200
  return g
}

const picker = (): KeyframePicker =>
  new KeyframePicker(W, H, { still: 2.5, fresh: 6, stillSamples: 3 })

describe('rip capture key frames', () => {
  it('measures motion and sharpness', () => {
    expect(motion(scene(2), scene(2))).toBe(0)
    expect(motion(scene(2), scene(12))).toBeGreaterThan(10)
    expect(sharpness(scene(2, true), W, H)).toBeGreaterThan(sharpness(scene(2), W, H))
  })

  it('turns RGBA into grey', () => {
    expect([...toGrey(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))]).toEqual([255, 0])
  })

  it('picks once per still stretch, after it has been still long enough', () => {
    const p = picker()
    expect(p.push(scene(2)).pick).toBeNull()
    expect(p.push(scene(2)).pick).toBeNull()
    expect(p.state).toBe('settling')
    expect(p.push(scene(2)).pick).toBeNull()
    const third = p.push(scene(2))
    expect(third.pick).not.toBeNull()
    expect(p.state).toBe('held')
    expect(p.push(scene(2)).pick).toBeNull()
  })

  it('picks the sharpest sample of the stretch', () => {
    const p = picker()
    p.push(scene(12))
    p.push(scene(2)) // moved
    const sharp = p.push(scene(2, true)) // still enough: detail is fine-grained, small mean change
    p.push(scene(2))
    const r = p.push(scene(2))
    expect(r.pick?.seq).toBe(sharp.seq)
  })

  it('says whether a stretch looks unlike the last key frame kept', () => {
    const p = picker()
    const still = (x: number): Pick | null => {
      let pick: Pick | null = null
      for (let i = 0; i < 4; i++) pick = p.push(scene(x)).pick ?? pick
      return pick
    }
    const first = still(2)
    expect(first?.fresh).toBe(true)
    p.markKept(scene(2))
    p.push(scene(20)) // hand moves, then back to the same card
    expect(still(2)?.fresh).toBe(false)
    p.push(scene(20))
    expect(still(14)?.fresh).toBe(true)
    // Not kept: the last key frame is still the first card's.
    p.push(scene(20))
    expect(still(14)?.fresh).toBe(true)
  })

  it('a frame kept by hand counts as the last key frame', () => {
    const p = picker()
    p.push(scene(2))
    p.markKept(scene(2))
    for (let i = 0; i < 4; i++) expect(p.push(scene(2)).pick).toBeNull()
  })

  describe('card look', () => {
    /** A 48 x 64 RGBA card: a gradient, a bright block at (bx, by), and an overall gain. */
    const card = (bx: number, by: number, gain = 1): RgbaImage => {
      const width = 48
      const height = 64
      const data = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const inBlock = x >= bx && x < bx + 12 && y >= by && y < by + 16
          const v = Math.min(255, (40 + x + y + (inBlock ? 120 : 0)) * gain)
          data.set([v, v, v, 255], (y * width + x) * 4)
        }
      return { width, height, data }
    }

    it('scores the same card as the same under different light', () => {
      expect(lookDiff(blockLook(card(4, 4)), blockLook(card(4, 4, 1.4)))).toBeLessThan(1)
    })

    it('scores a different card as different', () => {
      expect(lookDiff(blockLook(card(4, 4)), blockLook(card(32, 44)))).toBeGreaterThan(SAME_CARD)
    })

    it('treats mismatched looks as unrelated', () => {
      expect(lookDiff(new Float32Array(4), new Float32Array(8))).toBe(100)
    })
  })
})
