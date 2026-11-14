import { describe, expect, it } from 'vitest'
import { css, fromOklab, lch, unlch } from '@/lib/wash/color'
import type { RGB } from '@/lib/wash/color'
import { FRAME, familiesFromPixels } from '@/lib/wash/families'
import { fit } from '@/lib/wash/fit'
import { field } from '@/lib/wash/field'

const fill = (rgb: RGB, n = 1024): RGB[] => Array.from({ length: n }, () => rgb)
const mix = (...parts: [RGB, number][]): RGB[] => parts.flatMap(([c, n]) => fill(c, n))
const hue = (h: number): RGB => fromOklab(unlch([0.65, 0.15, h]))

describe('wash engine', () => {
  it('finds one family per distinct hue, up to five', () => {
    const five = mix(
      [hue(20), 200],
      [hue(92), 200],
      [hue(164), 200],
      [hue(236), 200],
      [hue(308), 200],
      [[60, 200, 200], 24]
    )
    expect(familiesFromPixels(five).fams).toHaveLength(5)
    expect(familiesFromPixels(mix([[220, 40, 40], 600], [[40, 90, 220], 424])).fams).toHaveLength(2)
  })
  it('gives single-colour art a second pool', () => {
    expect(familiesFromPixels(fill([200, 40, 40])).fams).toHaveLength(2)
  })
  it('drops families under 15% of the top one', () => {
    expect(familiesFromPixels(mix([[220, 40, 40], 950], [[40, 90, 220], 74])).fams.length).toBe(2)
  })
  it('leads grey Yu-Gi-Oh! art with its frame colour', () => {
    const f = familiesFromPixels(fill([90, 90, 95]), 'effect')
    expect(f.greyArt).toBe(true)
    expect(Math.abs(lch(f.fams[0].lab)[2] - FRAME.effect[0])).toBeLessThan(2)
  })
  it('flags grey art whatever the frame, so the pick can skip it', () => {
    expect(familiesFromPixels(fill([90, 90, 95]), 'pokemon').greyArt).toBe(true)
    expect(familiesFromPixels(fill([90, 90, 95])).greyArt).toBe(true)
    expect(familiesFromPixels(fill([200, 40, 40])).greyArt).toBe(false)
  })
  it('knows the pendulum frames', () => {
    const f = familiesFromPixels(fill([90, 90, 95]), 'effect_pendulum')
    expect(Math.abs(lch(f.fams[0].lab)[2] - FRAME.effect[0])).toBeLessThan(2)
  })
  it.each(['dark', 'light'] as const)('fits every pool and the base to 4.5:1 in %s', (t) => {
    for (const px of [fill([250, 240, 120]), fill([20, 20, 30]), mix([[255, 255, 255], 500], [[0, 200, 255], 524])]) {
      expect(fit(familiesFromPixels(px), t).worst).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('shares sum to 1', () => {
    const f = familiesFromPixels(mix([[220, 40, 40], 600], [[40, 90, 220], 424]))
    expect(f.fams.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1)
  })
  it('places pools the same way for the same seed, differently for another', () => {
    const fitted = fit(familiesFromPixels(mix([[220, 40, 40], 600], [[40, 90, 220], 424])), 'dark')
    expect(field(fitted, { seed: 7 })).toBe(field(fitted, { seed: 7 }))
    expect(field(fitted, { seed: 7 })).not.toBe(field(fitted, { seed: 8 }))
    expect(field(fitted, { withBase: false })).not.toContain(css(fitted.base))
  })
})
