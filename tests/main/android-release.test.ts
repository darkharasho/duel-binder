import { describe, expect, it } from 'vitest'
import { isNewer, pickApk } from '../../src/shared/androidRelease'

const asset = (name: string, size = 1000): Record<string, unknown> => ({
  name,
  size,
  browser_download_url: `https://github.com/darkharasho/duel-binder/releases/download/v0.48.0/${name}`
})

describe('pickApk', () => {
  it("finds the release's APK", () => {
    const release = {
      tag_name: 'v0.48.0',
      assets: [asset('Duel-Binder-0.48.0.dmg'), asset('Duel-Binder-0.48.0.apk', 25_000_000)]
    }
    expect(pickApk(release)).toEqual({
      version: '0.48.0',
      name: 'Duel-Binder-0.48.0.apk',
      size: 25_000_000,
      url: 'https://github.com/darkharasho/duel-binder/releases/download/v0.48.0/Duel-Binder-0.48.0.apk'
    })
  })

  it('is null without an APK', () => {
    expect(
      pickApk({
        tag_name: 'v0.48.0',
        assets: [asset('Duel-Binder-0.48.0.aab'), asset('x.AppImage')]
      })
    ).toBeNull()
    expect(pickApk({ tag_name: 'v0.48.0', assets: [asset('something-else.apk')] })).toBeNull()
    expect(pickApk({ tag_name: 'v0.48.0' })).toBeNull()
  })

  it('is null for anything that is not a release', () => {
    for (const bad of [null, 'v1', 42, [], { assets: [asset('Duel-Binder-1.0.0.apk')] }]) {
      expect(pickApk(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('isNewer', () => {
  it('compares versions by number', () => {
    expect(isNewer('0.48.0', '0.47.0')).toBe(true)
    expect(isNewer('0.47.10', '0.47.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  })

  it('is false for the same or an older version', () => {
    expect(isNewer('0.47.0', '0.47.0')).toBe(false)
    expect(isNewer('0.46.9', '0.47.0')).toBe(false)
  })

  it('is false for versions it cannot read', () => {
    expect(isNewer('x', '0.47.0')).toBe(false)
    expect(isNewer('0.48.0', 'dev')).toBe(false)
    expect(isNewer('0.48.0-beta', '0.47.0')).toBe(false)
  })
})
