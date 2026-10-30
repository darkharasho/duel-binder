import { describe, expect, it } from 'vitest'
import { HASH_WORDS, hamming } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints, encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import {
  encodeFingerprintRefs,
  hashHex,
  isArtVariant,
  parseFingerprintRefs,
  type RefMatch
} from '../../src/shared/scan/fingerprintRefs'
import { mergeMatch } from '../../src/renderer/src/features/scan/vision/detect'

/** A hash with the first `bits` bits of `from` flipped. */
function flip(from: Uint32Array, bits: number, start = 0): Uint32Array {
  const h = from.slice()
  for (let i = start; i < start + bits; i++) h[i >> 5] ^= 1 << (i & 31)
  return h
}

const ZERO = new Uint32Array(HASH_WORDS)
const KEY = 'ja|1|Original Artwork Collection|YAC1-JP006|Prismatic Secret Rare'

describe('hashHex', () => {
  it("is the record's 32 hash bytes as the file holds them, in lowercase hex", () => {
    const h = new Uint32Array(HASH_WORDS)
    h[0] = 0x04030201
    h[7] = 0xdeadbeef
    const hex = hashHex(h)
    expect(hex).toHaveLength(64)
    expect(hex.startsWith('01020304')).toBe(true)
    expect(hex.endsWith('efbeadde')).toBe(true)
  })
})

describe('isArtVariant', () => {
  it.each([
    ['Ultra Rare', 'Overframe', true],
    ['Ultra Rare (Overframe)', null, true],
    ['Prismatic Secret Rare', 'Manga-Style', true],
    ['Ultra Rare', 'New artwork', true],
    ['Ultra Rare', null, false],
    ['Starlight Rare', null, false],
    ['Rare (Green)', null, false],
    ['Ultra Rare', 'Blue', false],
    ['Secret Rare', '', false]
  ])('%s / %s: %s', (rarity, variant, art) => {
    expect(isArtVariant(rarity, variant)).toBe(art)
  })
})

describe('fingerprint refs file', () => {
  it('round-trips', () => {
    const bytes = encodeFingerprintRefs([{ imageId: 7, hash: ZERO, printings: [KEY] }])
    expect(parseFingerprintRefs(new TextDecoder().decode(bytes))).toEqual({
      v: 1,
      refs: [{ h: '0'.repeat(64), imageId: 7, printings: [KEY] }]
    })
  })

  it.each([
    ['not JSON', '{'],
    ['another version', JSON.stringify({ v: 2, refs: [] })],
    ['no refs list', JSON.stringify({ v: 1 })],
    ['a short hash', JSON.stringify({ v: 1, refs: [{ h: 'ab', imageId: 1, printings: [KEY] }] })],
    [
      'a bad image id',
      JSON.stringify({ v: 1, refs: [{ h: '0'.repeat(64), imageId: -1, printings: [KEY] }] })
    ],
    [
      'no printings',
      JSON.stringify({ v: 1, refs: [{ h: '0'.repeat(64), imageId: 1, printings: [] }] })
    ],
    [
      'a printing that is no key',
      JSON.stringify({ v: 1, refs: [{ h: '0'.repeat(64), imageId: 1, printings: [3] }] })
    ]
  ])('rejects %s', (_, text) => {
    expect(() => parseFingerprintRefs(text)).toThrow('Not a fingerprint refs file')
  })
})

describe('FingerprintIndex with refs', () => {
  // Image 5: its card art (base) and an overframe scan (ref) 60 bits off it; image 9 another card.
  const base = ZERO
  const overframe = flip(ZERO, 60)
  const other = flip(ZERO, 128, 100)
  const file = (): ReturnType<typeof decodeFingerprints> =>
    decodeFingerprints(
      encodeFingerprints([
        { imageId: 5, hash: base },
        { imageId: 5, hash: overframe },
        { imageId: 9, hash: other }
      ])
    )

  it('gives matches as before when no refs are attached', () => {
    expect(file().nearest(flip(overframe, 4), 2)).toEqual([
      { imageId: 5, distance: 4 },
      { imageId: 9, distance: hamming(flip(overframe, 4), 0, other, 0) }
    ])
  })

  it("reports an image's reference scans and its base art distance beside its match", () => {
    const idx = file()
    expect(idx.withRefs([{ h: hashHex(overframe), imageId: 5, printingIds: [41, 42] }])).toBe(1)
    const photo = flip(overframe, 4)
    const [top, next] = idx.nearest(photo, 2)
    expect(top).toEqual({
      imageId: 5,
      distance: 4,
      base: 56,
      refs: [{ h: hashHex(overframe), printingIds: [41, 42], distance: 4 }]
    })
    // An image without reference scans is given as before.
    expect(next).toEqual({ imageId: 9, distance: hamming(photo, 0, other, 0) })
  })

  it('keeps the best of each distance when an artwork is matched more than once', () => {
    const ref = (h: string, distance: number): RefMatch => ({ h, printingIds: [41], distance })
    expect(
      mergeMatch(
        { imageId: 5, distance: 20, base: 40, refs: [ref('a', 20), ref('b', 30)] },
        { imageId: 5, distance: 18, base: 44, refs: [ref('b', 18)] }
      )
    ).toEqual({ imageId: 5, distance: 18, base: 40, refs: [ref('b', 18), ref('a', 20)] })
    expect(mergeMatch({ imageId: 9, distance: 30 }, { imageId: 9, distance: 25 })).toEqual({
      imageId: 9,
      distance: 25
    })
  })

  it('ignores refs whose hash or image the file does not hold', () => {
    const idx = file()
    expect(
      idx.withRefs([
        { h: hashHex(flip(ZERO, 3)), imageId: 5, printingIds: [41] },
        { h: hashHex(overframe), imageId: 9, printingIds: [41] }
      ])
    ).toBe(0)
    expect(idx.nearest(overframe, 1)).toEqual([{ imageId: 5, distance: 0 }])
  })
})
