import { describe, expect, it } from 'vitest'
import templates from '../../src/shared/scan/gemPatterns.json'
import {
  gemPattern,
  gemScores,
  gemVersion,
  H,
  STAMP,
  SYMBOL,
  W,
  type GemScores
} from '../../src/shared/scan/gemPattern'
import type { RgbaImage } from '../../src/shared/scan/types'

const scores = (s: Partial<GemScores>): GemScores => ({
  energy: 0,
  ball: 0,
  master: 0,
  stamp: 0,
  ...s
})

/**
 * An upright card (842x1228) of mid grey, with a template drawn as grey levels into its box: each
 * shrunk pixel a 10x10 block, as the scan's shrink reads it back.
 */
function cardWith(drawn: { box: typeof SYMBOL; values: number[] }[]): RgbaImage {
  const width = 842
  const height = 1228
  const data = new Uint8ClampedArray(width * height * 4).fill(128)
  const sx = width / W
  const sy = height / H
  for (const { box, values } of drawn)
    for (let y = 0; y < box.h; y++)
      for (let x = 0; x < box.w; x++) {
        const v = Math.max(0, Math.min(255, 128 + 40 * values[y * box.w + x]))
        const x0 = Math.floor((box.x0 + x) * sx)
        const y0 = Math.floor((box.y0 + y) * sy)
        for (let yy = y0; yy < Math.floor((box.y0 + y + 1) * sy); yy++)
          for (let xx = x0; xx < Math.floor((box.x0 + x + 1) * sx); xx++) {
            const i = (yy * width + xx) * 4
            data[i] = data[i + 1] = data[i + 2] = v
          }
      }
  return { width, height, data }
}

describe('gemScores', () => {
  it('matches the template drawn at its place best, and well', () => {
    const ball = gemScores(cardWith([{ box: SYMBOL, values: templates.ball }]))
    expect(ball.ball).toBeGreaterThan(0.9)
    expect(gemPattern(ball)).toBe('ball')
    const master = gemScores(cardWith([{ box: SYMBOL, values: templates.master }]))
    expect(gemPattern(master)).toBe('master')
    const stamp = gemScores(cardWith([{ box: STAMP, values: templates.stamp }]))
    expect(stamp.stamp).toBeGreaterThan(0.9)
    expect(gemPattern(stamp)).toBe('stamp')
  })

  it('names nothing on a plain card', () => {
    expect(gemPattern(gemScores(cardWith([])))).toBeNull()
  })
})

describe('gemPattern', () => {
  it('names a symbol only past its floor and ahead of the others by the margins', () => {
    expect(gemPattern(scores({ ball: 0.85, energy: 0.7, master: 0.65 }))).toBe('ball')
    expect(gemPattern(scores({ ball: 0.85, energy: 0.8, master: 0.6 }))).toBeNull()
    expect(gemPattern(scores({ ball: 0.6, energy: 0.3, master: 0.3 }))).toBeNull()
    expect(gemPattern(scores({ master: 0.75, ball: 0.68, energy: 0.5 }))).toBe('master')
    expect(gemPattern(scores({ master: 0.75, ball: 0.72, energy: 0.5 }))).toBeNull()
    expect(gemPattern(scores({ energy: 0.7, ball: 0.62, master: 0.4 }))).toBe('energy')
    expect(gemPattern(scores({ energy: 0.7, ball: 0.62, master: 0.6 }))).toBeNull()
  })

  it('names the stamp only with no symbol named', () => {
    expect(gemPattern(scores({ stamp: 0.6 }))).toBe('stamp')
    expect(gemPattern(scores({ stamp: 0.6, ball: 0.9, energy: 0.7, master: 0.6 }))).toBe('ball')
    expect(gemPattern(scores({ stamp: 0.5 }))).toBeNull()
    expect(gemPattern(null)).toBeNull()
  })
})

describe('gemVersion', () => {
  const vol7 = [
    { setCode: 'CBB7C 1501', rarity: 'Holofoil' },
    { setCode: 'CBB7C 1502', rarity: 'Poke Ball Pattern' },
    { setCode: 'CBB7C 1503', rarity: 'Holofoil' },
    { setCode: 'CBB7C 1505', rarity: 'Master Ball Pattern' },
    { setCode: 'CBB7C 1506', rarity: 'Set Logo Holofoil' }
  ]

  it('takes the version of the catalog rarity, or Vol. 7 energy symbol by number', () => {
    expect(gemVersion(scores({ ball: 0.9, energy: 0.7, master: 0.6 }), vol7)?.setCode).toBe(
      'CBB7C 1502'
    )
    expect(gemVersion(scores({ master: 0.8, ball: 0.6, energy: 0.4 }), vol7)?.setCode).toBe(
      'CBB7C 1505'
    )
    expect(gemVersion(scores({ stamp: 0.7 }), vol7)?.setCode).toBe('CBB7C 1506')
    expect(gemVersion(scores({ energy: 0.75, ball: 0.65, master: 0.4 }), vol7)?.setCode).toBe(
      'CBB7C 1501'
    )
  })

  it('takes none when the pattern has no one version among the options', () => {
    const energy = scores({ energy: 0.75, ball: 0.65, master: 0.4 })
    // Another Gem Pack's 01 isn't known to be its energy symbol.
    expect(gemVersion(energy, [{ setCode: 'CBB6C 1501', rarity: 'Holofoil' }])).toBeNull()
    const ball = scores({ ball: 0.9, energy: 0.7, master: 0.6 })
    expect(
      gemVersion(
        ball,
        vol7.filter((o) => o.rarity !== 'Poke Ball Pattern')
      )
    ).toBeNull()
    expect(
      gemVersion(ball, [...vol7, { setCode: 'CBB7C 1508', rarity: 'Poke Ball Pattern' }])
    ).toBeNull()
    expect(gemVersion(scores({}), vol7)).toBeNull()
  })
})
