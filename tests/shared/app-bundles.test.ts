import { describe, it, expect } from 'vitest'
import {
  pickRelease,
  pickShellUpdate,
  signedMessage,
  type IndexEntry,
  type ManifestEntry
} from '../../src/shared/appBundles'

const e = (version: string, fingerprint: string, schema: number, extra: Partial<IndexEntry> = {}): IndexEntry => ({
  version,
  fingerprint,
  schema,
  ...extra
})

describe('pickRelease', () => {
  const index = [e('0.101.0', 'fpA', 48), e('0.102.0', 'fpA', 48), e('0.103.0', 'fpB', 48)]

  it('offers the newest same-fingerprint release', () => {
    expect(pickRelease(index, { fingerprint: 'fpA', current: '0.101.0' })?.version).toBe('0.102.0')
  })
  it('nothing when current is newest', () => {
    expect(pickRelease(index, { fingerprint: 'fpA', current: '0.102.0' })).toBeNull()
  })
  it('skips withdrawn', () => {
    const idx = [e('0.101.0', 'fpA', 48), e('0.102.0', 'fpA', 48, { withdrawn: true })]
    expect(pickRelease(idx, { fingerprint: 'fpA', current: '0.101.0' })).toBeNull()
  })
  it('withdrawn current falls back on the same schema', () => {
    const idx = [e('0.101.0', 'fpA', 48), e('0.102.0', 'fpA', 48, { withdrawn: true })]
    expect(pickRelease(idx, { fingerprint: 'fpA', current: '0.102.0' })?.version).toBe('0.101.0')
  })
  it('withdrawn current, no same-schema fallback', () => {
    const idx = [e('0.101.0', 'fpA', 47), e('0.102.0', 'fpA', 48, { withdrawn: true })]
    expect(pickRelease(idx, { fingerprint: 'fpA', current: '0.102.0' })).toBeNull()
  })
})

describe('pickShellUpdate', () => {
  it('newer APK on another fingerprint', () => {
    const idx = [e('0.104.0', 'fpB', 48, { apkUrl: 'https://x/a.apk' })]
    expect(pickShellUpdate(idx, { fingerprint: 'fpA', builtin: '0.101.0' })).toEqual({
      version: '0.104.0',
      url: 'https://x/a.apk'
    })
    expect(pickShellUpdate(idx, { fingerprint: 'fpB', builtin: '0.101.0' })).toBeNull()
    expect(pickShellUpdate([e('0.104.0', 'fpB', 48)], { fingerprint: 'fpA', builtin: '0.101.0' })).toBeNull()
  })
})

describe('signedMessage', () => {
  const a: ManifestEntry = { file_name: 'a.js', file_hash: 'h1', download_url: 'u1' }
  const b: ManifestEntry = { file_name: 'b.js', file_hash: 'h2', download_url: 'u2' }
  it('is stable across key order', () => {
    expect(signedMessage('ios', '1.0.0', [a, b])).toEqual(signedMessage('ios', '1.0.0', [b, a]))
    expect(signedMessage('ios', '1.0.0', [a, b])).not.toEqual(
      signedMessage('ios', '1.0.0', [a, { ...b, file_hash: 'h3' }])
    )
  })
})
