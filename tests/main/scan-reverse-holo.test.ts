import { describe, expect, it } from 'vitest'
import { bodyStats, reverseChecked, reverseVersion } from '../../src/shared/scan/reverseHolo'
import { REVERSE_BODY_LUM_MAX, REVERSE_SPREAD_MIN } from '../../src/shared/scan/thresholds'
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
  it('thresholds are strict', () => {
    // Built to sit exactly on each threshold (ref ratio 1 and spread 0 make the differences exact).
    const flatRef = { ratio: 1, spread: 0 }
    expect(
      reverseVersion({ ratio: REVERSE_BODY_LUM_MAX, spread: REVERSE_SPREAD_MIN }, flatRef)
    ).toBe('Normal')
    expect(
      reverseVersion({ ratio: REVERSE_BODY_LUM_MAX - 0.001, spread: 0 }, flatRef)
    ).toBe('Reverse Holofoil')
    expect(
      reverseVersion({ ratio: 1, spread: REVERSE_SPREAD_MIN + 0.001 }, flatRef)
    ).toBe('Reverse Holofoil')
  })
})

describe('reverseChecked', () => {
  it('matches the set prefix', () => {
    expect(reverseChecked('DLR 002/103')).toBe(true)
    expect(reverseChecked('DRI 208/182')).toBe(false)
    expect(reverseChecked('DLRX 1')).toBe(false)
    expect(reverseChecked(null)).toBe(false)
  })
})

describe('bodyStats numbers', () => {
  // Pseudo-random images; the expected numbers were measured before the shrink was limited to the
  // art and body regions, which must not move them.
  function gen(w: number, h: number, alpha: boolean): RgbaImage {
    let s = 12345
    const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff)
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = r() % 256
      data[i * 4 + 1] = r() % 256
      data[i * 4 + 2] = r() % 256
      data[i * 4 + 3] = alpha ? (i % 7 === 0 ? 255 : r() % 256) : 255
    }
    return { width: w, height: h, data }
  }
  const cases: [string, RgbaImage, number, number][] = [
    ['noise 842x1228', gen(842, 1228, false), 1.0001094572927474, 0.32087245697988254],
    ['partial alpha 842x1228', gen(842, 1228, true), 1.0000784554220603, 0.041345867478100054],
    ['odd 700x1000', gen(700, 1000, false), 0.9984252344204796, 0.4044768716686001],
    ['odd alpha 333x457', gen(333, 457, true), 0.9999645102681148, 0.15140985899880005]
  ]
  for (const [name, img, ratio, spread] of cases)
    it(`matches the earlier numbers: ${name}`, () => {
      const s = bodyStats(img)
      expect(Math.abs(s.ratio - ratio)).toBeLessThan(1e-9)
      expect(Math.abs(s.spread - spread)).toBeLessThan(1e-9)
    })
})
