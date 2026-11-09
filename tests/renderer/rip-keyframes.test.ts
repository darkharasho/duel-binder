import { describe, expect, it } from 'vitest'
import {
  KeyframePicker,
  motion,
  sharpness,
  toGrey
} from '../../src/renderer/src/features/admin/keyframes'

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

  it('skips a stretch that looks like the last key frame, and keeps a new card', () => {
    const p = picker()
    const still = (x: number): number | null => {
      let pick: number | null = null
      for (let i = 0; i < 4; i++) pick = p.push(scene(x)).pick?.seq ?? pick
      return pick
    }
    expect(still(2)).not.toBeNull()
    p.push(scene(20)) // hand moves, then back to the same card
    expect(still(2)).toBeNull()
    p.push(scene(20))
    expect(still(14)).not.toBeNull()
  })

  it('a frame kept by hand counts as the last key frame', () => {
    const p = picker()
    p.push(scene(2))
    p.markKept(scene(2))
    for (let i = 0; i < 4; i++) expect(p.push(scene(2)).pick).toBeNull()
  })
})
