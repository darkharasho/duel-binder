import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, parsePrefs, validPrefsPatch } from '../../src/shared/prefs'

const colours = {
  fams: [
    { lab: [0.6, 0.1, -0.05], share: 0.7 },
    { lab: [0.5, -0.08, 0.1], share: 0.3 }
  ],
  dark: [0.2, 0.01, 0.02],
  vivid: 0.12
}

describe('parsePrefs', () => {
  it('falls back to defaults for junk', () => {
    expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('x')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs({ wash: { mode: 'neon' } })).toEqual(DEFAULT_PREFS)
  })

  it('round-trips a valid locked value', () => {
    const p = { wash: { mode: 'locked', locked: colours } }
    expect(parsePrefs(p)).toEqual(p)
  })

  it('drops an invalid locked value but keeps the mode', () => {
    const raw = { wash: { mode: 'locked', locked: { fams: [], dark: [0, 0, 0], vivid: 0 } } }
    expect(parsePrefs(raw)).toEqual({ wash: { mode: 'locked' } })
  })
})

describe('validPrefsPatch', () => {
  it('accepts valid patches', () => {
    expect(validPrefsPatch({ wash: { mode: 'colourless' } })).not.toBeNull()
    expect(validPrefsPatch({ wash: { mode: 'locked', locked: colours } })).not.toBeNull()
    expect(validPrefsPatch({})).toEqual({})
  })

  it('rejects invalid input', () => {
    expect(validPrefsPatch({ wash: { mode: 'neon' } })).toBeNull()
    expect(
      validPrefsPatch({
        wash: { mode: 'locked', locked: { ...colours, fams: [{ lab: [NaN, 0, 0], share: 1 }] } }
      })
    ).toBeNull()
    const nine = Array.from({ length: 9 }, () => ({ lab: [0.5, 0, 0], share: 0.1 }))
    expect(validPrefsPatch({ wash: { mode: 'locked', locked: { ...colours, fams: nine } } })).toBeNull()
    expect(validPrefsPatch('x')).toBeNull()
    expect(validPrefsPatch(null)).toBeNull()
    expect(validPrefsPatch({ wash: { mode: 'random' }, other: 1 })).toBeNull()
  })
})
