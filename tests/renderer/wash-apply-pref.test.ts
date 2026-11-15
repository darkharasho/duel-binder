import type { Prefs } from '@shared/prefs'
import { applyWashPref } from '@/lib/wash/applyPref'
import { lch } from '@/lib/wash/color'
import { colourlessFamilies, gameFallback } from '@/lib/wash/sample'
import type { WashState } from '@/components/artWashContext'

const page: WashState = { families: gameFallback('ygo', () => 0.5), seed: 42, strength: 0.8 }
const lockedColours = {
  fams: [{ lab: [0.6, 0.1, 0.05] as [number, number, number], share: 1 }],
  dark: [0.2, 0.01, 0.0] as [number, number, number],
  vivid: 0.1
}

describe('colourlessFamilies', () => {
  it('keeps chroma at or under 0.3 of the game colour', () => {
    const base = gameFallback('pkm')
    const grey = colourlessFamilies('pkm')
    expect(grey.greyArt).toBe(false)
    expect(grey.fams.map((f) => f.share)).toEqual([0.65, 0.35])
    grey.fams.forEach((f, i) => {
      expect(lch(f.lab)[1]).toBeLessThanOrEqual(lch(base.fams[i].lab)[1] * 0.3 + 1e-9)
    })
    const [L, C] = lch(grey.dark)
    expect(L).toBeCloseTo(0.19, 6)
    expect(C).toBeCloseTo(0.004, 6)
  })
})

describe('applyWashPref', () => {
  it('random passes the page wash through', () => {
    expect(applyWashPref(page, { mode: 'random' }, 'ygo')).toBe(page)
  })

  it('random with no wash gives the existing default', () => {
    expect(applyWashPref(null, { mode: 'random' }, 'ygo')).toEqual({
      families: gameFallback('ygo'),
      seed: 0,
      strength: 1
    })
  })

  it('locked keeps the page seed and strength', () => {
    const pref: Prefs['wash'] = { mode: 'locked', locked: lockedColours }
    expect(applyWashPref(page, pref, 'ygo')).toEqual({
      families: { ...lockedColours, greyArt: false },
      seed: 42,
      strength: 0.8
    })
    expect(applyWashPref(null, pref, 'ygo')).toMatchObject({ seed: 0, strength: 1 })
  })

  it('locked without colours falls through to random', () => {
    expect(applyWashPref(page, { mode: 'locked' }, 'ygo')).toBe(page)
  })

  it('colourless ignores the page', () => {
    expect(applyWashPref(page, { mode: 'colourless' }, 'ygo')).toEqual({
      families: colourlessFamilies('ygo'),
      seed: 0,
      strength: 0.4
    })
  })
})
