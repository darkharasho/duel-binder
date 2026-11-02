import { describe, expect, it } from 'vitest'
import { versionCode, versionName } from '../../scripts/android-version'

describe('Android version numbers', () => {
  it('turns the app version into a versionCode', () => {
    expect(versionCode('0.47.0')).toBe(47000)
    expect(versionCode('1.2.3')).toBe(1002003)
  })

  it('always grows with the version', () => {
    expect(versionCode('0.47.10')).toBeGreaterThan(versionCode('0.47.9'))
    expect(versionCode('0.48.0')).toBeGreaterThan(versionCode('0.47.999'))
    expect(versionCode('1.0.0')).toBeGreaterThan(versionCode('0.999.999'))
  })

  it('keeps the version as the versionName', () => {
    expect(versionName('0.47.0')).toBe('0.47.0')
  })

  it('refuses versions it cannot number', () => {
    for (const bad of ['1.2', '1.2.3-beta', 'v1.2.3', '0.1000.0', '0.1.1000', '2100.0.0']) {
      expect(() => versionCode(bad), bad).toThrow()
    }
  })
})
