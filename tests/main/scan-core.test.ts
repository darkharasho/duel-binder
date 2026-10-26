import { describe, expect, it } from 'vitest'
import { artHash, hamming } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints, encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { parseSetCode, setCodeCandidates, setPrefix } from '../../src/shared/scan/setCode'
import { pickRarity, rarityRank } from '../../src/shared/scan/rarity'
import { bestNameMatch, normalizeName } from '../../src/shared/scan/names'
import type { RgbaImage } from '../../src/shared/scan/types'

/** A gradient with a few filled rectangles, rendered at any size and brightness. */
function synth(
  size: number,
  rects: [number, number, number, number, number][],
  gain = 1
): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      let l = 60 + 80 * u + 40 * v
      for (const [rx, ry, rw, rh, val] of rects) {
        if (u >= rx && u < rx + rw && v >= ry && v < ry + rh) l = val
      }
      const o = (y * size + x) * 4
      data[o] = data[o + 1] = data[o + 2] = l * gain
      data[o + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

const shapesA: [number, number, number, number, number][] = [
  [0.1, 0.1, 0.4, 0.3, 240],
  [0.5, 0.55, 0.35, 0.35, 20],
  [0.15, 0.7, 0.2, 0.2, 200]
]
const shapesC: [number, number, number, number, number][] = [
  [0.55, 0.05, 0.4, 0.4, 10],
  [0.05, 0.5, 0.3, 0.45, 250],
  [0.4, 0.45, 0.2, 0.2, 30]
]

describe('artHash', () => {
  it('is stable under resize and mild brightness change, distinct across images', () => {
    const a = synth(200, shapesA)
    const b = synth(120, shapesA, 1.1)
    const c = synth(200, shapesC)
    const ha = artHash(a)
    expect(ha).toHaveLength(8)
    expect(hamming(ha, 0, artHash(b), 0)).toBeLessThan(20)
    expect(hamming(ha, 0, artHash(c), 0)).toBeGreaterThan(80)
  })

  it('hamming honours word offsets', () => {
    const x = new Uint32Array(16)
    x[8] = 0b111
    expect(hamming(x, 0, x, 8)).toBe(3)
    expect(hamming(x, 8, x, 8)).toBe(0)
  })
})

describe('fingerprint file', () => {
  const h1 = artHash(synth(100, shapesA))
  const h2 = artHash(synth(100, shapesC))

  it('round-trips and finds nearest within candidates', () => {
    const idx = decodeFingerprints(
      encodeFingerprints([
        { imageId: 9, hash: h2 },
        { imageId: 5, hash: h1 }
      ])
    )
    expect(idx.count).toBe(2)
    expect(idx.nearest(h1, 1)[0]).toEqual({ imageId: 5, distance: 0 })
    expect(idx.nearest(h1, 2).map((n) => n.imageId)).toEqual([5, 9])
    expect(idx.nearest(h1, 1, new Set([9]))[0].imageId).toBe(9)
    expect(idx.nearest(h1, 1, new Set())).toEqual([])
  })

  it('accepts an ArrayBuffer and writes the documented header', () => {
    const bytes = encodeFingerprints([{ imageId: 7, hash: h1 }])
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('DBFP')
    expect(bytes).toHaveLength(11 + 36)
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    expect(decodeFingerprints(buf as ArrayBuffer).count).toBe(1)
  })

  it('rejects bad magic and truncated data', () => {
    expect(() => decodeFingerprints(new Uint8Array([1, 2, 3]))).toThrow('Not a fingerprint file')
    const bytes = encodeFingerprints([{ imageId: 7, hash: h1 }])
    expect(() => decodeFingerprints(bytes.slice(0, bytes.length - 1))).toThrow(
      'Not a fingerprint file'
    )
    const bad = bytes.slice()
    bad[0] = 0x58
    expect(() => decodeFingerprints(bad)).toThrow('Not a fingerprint file')
  })
})

describe('set codes', () => {
  it.each([
    ['LOB-EN005', 'LOB-EN005'],
    ['LOB-EN0O5', 'LOB-EN005'],
    ['mp19-en001', 'MP19-EN001'],
    ['SDK-001', 'SDK-001'],
    ['LOB-DE005', 'LOB-DE005'],
    ['SR14-DE023', 'SR14-DE023'],
    ['SDK-JP001', 'SDK-JP001'],
    ['RA02-KR006', 'RA02-KR006'],
    ['LOB-001', 'LOB-001'],
    ['LOB-E001', 'LOB-E001'],
    ['LOB-EO01', 'LOB-EO01'],
    ['LOB-XX005', null],
    ['SR14DE023', 'SR14-DE023'],
    ['SDKJP001', 'SDK-JP001'],
    ['hello', null],
    ['RA01 - EN 054', 'RA01-EN054'],
    ['RA01 – EN 054', 'RA01-EN054'],
    ['DUPO-ENA01', 'DUPO-ENA01'],
    // OCR drops the thin dash; only two-letter regions parse then.
    ['BROLEN062', 'BROL-EN062'],
    ['LOBEN005', 'LOB-EN005'],
    ['CT12EN001ATK2500', 'CT12-EN001'],
    ['BROL-EN062', 'BROL-EN062'],
    ['LOBDE005', 'LOB-DE005'],
    ['DUPOENA01', 'DUPO-ENA01'],
    ['ATK2500DEF2000', null]
  ])('parseSetCode(%s) = %s', (text, want) => expect(parseSetCode(text)).toBe(want))

  it('lists candidates with prefix zeros read as O as an alternate', () => {
    expect(setCodeCandidates('L0B-EN0O5')).toEqual(['L0B-EN005', 'LOB-EN005'])
    expect(setCodeCandidates('LOB-EN005')).toEqual(['LOB-EN005'])
    expect(setCodeCandidates('LOB-ENO05')).toContain('LOB-EN005')
    const mvp = setCodeCandidates('MVP1-ENS01')
    expect(mvp[0]).toBe('MVP1-ENS01')
    expect(mvp).toContain('MVP1-EN501')
    expect(new Set(mvp).size).toBe(mvp.length)
    expect(setCodeCandidates('SR14-DEO23')).toContain('SR14-DE023')
    expect(setCodeCandidates('SR14-DE023')).toEqual(['SR14-DE023'])
    expect(setCodeCandidates('LOB-001')).toEqual(['LOB-001', 'LOB-EN001'])
    expect(setCodeCandidates('L0B-JP0O1')).toEqual(['L0B-JP001', 'LOB-JP001'])
    expect(setCodeCandidates('nothing')).toEqual([])
    expect(setCodeCandidates('CT12ENOO1')).toContain('CT12-EN001')
    expect(setCodeCandidates('BPO1-ENO48')).toContain('BP01-EN048')
    expect(setCodeCandidates('DTO7-EN030')).toEqual(['DTO7-EN030', 'DT07-EN030'])
  })

  it('setPrefix returns the part before the dash', () => {
    expect(setPrefix('MP19-EN001')).toBe('MP19')
  })
})

describe('rarity', () => {
  it('picks rarity', () => {
    expect(pickRarity(['Ultra Rare'], null)).toEqual({ rarity: 'Ultra Rare', certain: true })
    expect(pickRarity(['Secret Rare', 'Common'], 'Secret Rare')).toEqual({
      rarity: 'Secret Rare',
      certain: true
    })
    expect(pickRarity(['Ultra Rare', 'Ultra Rare (Extended Art)', 'Secret Rare'], null)).toEqual({
      rarity: 'Ultra Rare',
      certain: false
    })
    expect(pickRarity(['Rare', 'Rare'], null)).toEqual({ rarity: 'Rare', certain: true })
  })

  it('ranks variants after their base and unknowns last', () => {
    expect(rarityRank('Ultra Rare (Extended Art)')).toBeGreaterThan(rarityRank('Ultra Rare'))
    expect(rarityRank('Ultra Rare (Extended Art)')).toBeLessThan(rarityRank('Ultimate Rare'))
    expect(rarityRank('Mystery')).toBeGreaterThan(rarityRank('Quarter Century Secret Rare'))
  })
})

describe('names', () => {
  const names = [
    { id: 1, name: 'Dark Magician' },
    { id: 2, name: 'Dark Magician Girl' },
    { id: 3, name: 'Kuriboh' }
  ]
  it('matches names with OCR noise and refuses ties', () => {
    expect(bestNameMatch('Dark Magicán', names)?.id).toBe(1)
    expect(bestNameMatch('Kur1boh', names)?.id).toBe(3)
    expect(bestNameMatch('zzzz', names)).toBeNull()
    expect(
      bestNameMatch('abcdefghij', [
        { id: 1, name: 'abcdefghix' },
        { id: 2, name: 'abcdefghiy' }
      ])
    ).toBeNull()
  })
  it('a shorter runner-up still counts against the margin', () => {
    const text = 'abcdefghijklmnopqrstuvwxyabcdefghijklmnopqrstuvwxy' // 50 letters
    // 10 letters changed: 0.8, just enough.
    const best = text.slice(0, 40) + 'ZZZZZZZZZZ'
    // 11 letters shorter: 0.78, too close behind.
    const runnerUp = text.slice(0, 39)
    expect(bestNameMatch(text, [{ id: 1, name: best }])?.score).toBeCloseTo(0.8)
    expect(
      bestNameMatch(text, [
        { id: 1, name: best },
        { id: 2, name: runnerUp }
      ])
    ).toBeNull()
  })
  it('uses names normalized ahead of time the same way', () => {
    const names = ['Dark Magician', 'Dark Magician Girl', 'Kuriboh'].map((name, i) => ({
      id: i + 1,
      name,
      norm: normalizeName(name)
    }))
    expect(bestNameMatch('Dark Magicán', names)).toEqual(
      bestNameMatch(
        'Dark Magicán',
        names.map(({ id, name }) => ({ id, name }))
      )
    )
    expect(bestNameMatch('Kur1boh', names)?.id).toBe(3)
  })
  it('normalizes', () => expect(normalizeName('Blue-Eyes W. Dragon!')).toBe('blueeyeswdragon'))
})
