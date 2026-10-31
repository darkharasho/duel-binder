import { describe, expect, it } from 'vitest'
import { decodeFingerprints, encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { pokemonId } from '../../src/shared/games/ids'

const hashOf = (seed: number): Uint32Array =>
  Uint32Array.from({ length: 8 }, (_, w) => (seed * (w + 3)) >>> 0)

// Captured from the v1 encoder before v2 existed: Yu-Gi-Oh files must stay byte-identical.
const GOLDEN_V1 =
  '4442465001000103000000aef4cc020bde6608b9d2330b67c7000e15bccd10c3b09a1371a567161f9a3419cd8e011ca3a95705ebfc06108ea65e153150b61ad4f90d2077a365251a4dbd2abdf6143060a06c35fffffffffdfffffffcfffffffbfffffffafffffff9fffffff8fffffff7fffffff6ffffff'

describe('DBFP versions', () => {
  it('v1 bytes are unchanged for ygo ids', () => {
    const entries = [4294967295, 46986414, 89631139].map((id, k) => ({
      imageId: id,
      hash: Uint32Array.from({ length: 8 }, (_, w) => (id * (w + 3) + k) >>> 0)
    }))
    const bytes = encodeFingerprints(entries)
    expect(bytes[4]).toBe(1)
    expect(Buffer.from(bytes).toString('hex')).toBe(GOLDEN_V1)
    expect(decodeFingerprints(bytes).count).toBe(3)
  })

  it('pokemon ids round-trip in v2', () => {
    const a = pokemonId('en/sv03-045#img')
    const b = pokemonId('ja/SV1S-001#img')
    expect(a).toBeGreaterThan(0xffffffff)
    const ha = hashOf(a)
    const hb = hashOf(b)
    const bytes = encodeFingerprints([
      { imageId: a, hash: ha },
      { imageId: b, hash: hb },
      { imageId: 46986414, hash: hashOf(46986414) }
    ])
    expect(bytes[4]).toBe(2)
    const index = decodeFingerprints(bytes)
    const ids = (index as unknown as { ids: Float64Array }).ids
    expect([...ids].sort((x, y) => x - y)).toEqual([46986414, a, b].sort((x, y) => x - y))
    expect(index.nearest(ha, 1)[0].imageId).toBe(a)
    expect(index.nearest(hb, 1)[0].imageId).toBe(b)
  })

  it('decoder rejects version 3', () => {
    const bytes = encodeFingerprints([{ imageId: 7, hash: hashOf(7) }])
    bytes[4] = 3
    expect(() => decodeFingerprints(bytes)).toThrow('Not a fingerprint file')
  })

  it('only: the same matches among the kept artworks, with no record of the rest', () => {
    const entries = [11, 22, 33].map((imageId) => ({ imageId, hash: hashOf(imageId) }))
    const index = decodeFingerprints(encodeFingerprints(entries))
    const kept = index.only(new Set([11, 33]))
    expect(kept.count).toBe(2)
    expect(kept.nearest(hashOf(22), 3).map((m) => m.imageId).sort()).toEqual([11, 33])
    expect(kept.nearest(hashOf(33), 1)).toEqual(index.nearest(hashOf(33), 1))
  })
})
