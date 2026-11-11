import { describe, expect, it } from 'vitest'
import { bodyStats, reverseChecked, reverseVersion } from '../../src/shared/scan/reverseHolo'
import type { RgbaImage } from '../../src/shared/scan/types'

function make(w: number, h: number, art: (x: number) => number, body: (x: number) => number, bodyAlpha = 255): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fy = y / h
      const inArt = fy >= 0.09 && fy < 0.47
      const inBody = fy >= 0.54 && fy < 0.86
      const v = inArt ? art(x) : inBody ? body(x) : 128
      const i = (y * w + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = inBody ? bodyAlpha : 255
    }
  return { width: w, height: h, data }
}

describe('bodyStats', () => {
  it('measures ratio and spread', () => {
    const s = bodyStats(make(842, 1228, () => 200, () => 100))
    expect(s.ratio).toBeCloseTo(0.5, 2)
    expect(s.spread).toBeCloseTo(0, 2)
  })
  it('does not depend on size', () => {
    const s = bodyStats(make(400, 584, () => 200, () => 100))
    expect(Math.abs(s.ratio - 0.5)).toBeLessThan(0.01)
    expect(Math.abs(s.spread)).toBeLessThan(0.01)
  })
  it('reads alternating wide columns as spread', () => {
    const s = bodyStats(make(842, 1228, () => 200, (x) => (Math.floor(x / 20) % 2 ? 150 : 50)))
    expect(Math.abs(s.spread - 0.5)).toBeLessThan(0.05)
  })
  it('flattens transparency on white', () => {
    const s = bodyStats(make(842, 1228, () => 200, () => 0, 0))
    expect(Math.abs(s.ratio - 255 / 200)).toBeLessThan(0.02)
  })
})

describe('reverseVersion', () => {
  const ref = { ratio: 0.5, spread: 0.1 }
  it('dark body is Reverse', () => expect(reverseVersion({ ratio: 0.3, spread: 0.1 }, ref)).toBe('Reverse Holofoil'))
  it('similar body is Normal', () => expect(reverseVersion({ ratio: 0.4, spread: 0.1 }, ref)).toBe('Normal'))
  it('wide spread is Reverse', () => expect(reverseVersion({ ratio: 0.5, spread: 0.35 }, ref)).toBe('Reverse Holofoil'))
  it('thresholds are strict', () =>
    expect(reverseVersion({ ratio: 0.345, spread: 0.3 }, { ratio: 0.5, spread: 0.1 })).toBe('Normal'))
})

describe('reverseChecked', () => {
  it('matches the set prefix', () => {
    expect(reverseChecked('DLR 002/103')).toBe(true)
    expect(reverseChecked('DRI 208/182')).toBe(false)
    expect(reverseChecked('DLRX 1')).toBe(false)
    expect(reverseChecked(null)).toBe(false)
  })
})
