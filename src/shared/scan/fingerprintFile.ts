import { HASH_WORDS, hamming } from './fingerprint'

// Format v1, little-endian: "DBFP", u8 version, u16 bits, u32 count,
// then per record u32 imageId + 32 hash bytes, sorted by imageId.
const MAGIC = [0x44, 0x42, 0x46, 0x50]
const VERSION = 1
const BITS = HASH_WORDS * 32
const HEADER = 11
const RECORD = 4 + HASH_WORDS * 4

export function encodeFingerprints(entries: { imageId: number; hash: Uint32Array }[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.imageId - b.imageId)
  const out = new Uint8Array(HEADER + sorted.length * RECORD)
  const view = new DataView(out.buffer)
  out.set(MAGIC, 0)
  view.setUint8(4, VERSION)
  view.setUint16(5, BITS, true)
  view.setUint32(7, sorted.length, true)
  sorted.forEach((e, i) => {
    const o = HEADER + i * RECORD
    view.setUint32(o, e.imageId, true)
    for (let w = 0; w < HASH_WORDS; w++) view.setUint32(o + 4 + w * 4, e.hash[w], true)
  })
  return out
}

export class FingerprintIndex {
  readonly count: number
  private readonly ids: Uint32Array
  private readonly hashes: Uint32Array

  constructor(ids: Uint32Array, hashes: Uint32Array) {
    this.count = ids.length
    this.ids = ids
    this.hashes = hashes
  }

  /** The k closest images by Hamming distance, closest first, optionally limited to candidates. */
  nearest(
    hash: Uint32Array,
    k: number,
    candidates?: ReadonlySet<number>
  ): { imageId: number; distance: number }[] {
    // One pass keeping the best k in order: this runs a few dozen times per camera frame.
    const found: { imageId: number; distance: number }[] = []
    if (k <= 0) return found
    const { hashes } = this
    for (let i = 0; i < this.count; i++) {
      const imageId = this.ids[i]
      if (candidates && !candidates.has(imageId)) continue
      const distance = hamming(hash, 0, hashes, i * HASH_WORDS)
      const last = found[found.length - 1]
      if (
        found.length === k &&
        (distance > last.distance || (distance === last.distance && imageId > last.imageId))
      )
        continue
      let at = found.length
      while (
        at > 0 &&
        (found[at - 1].distance > distance ||
          (found[at - 1].distance === distance && found[at - 1].imageId > imageId))
      )
        at--
      found.splice(at, 0, { imageId, distance })
      if (found.length > k) found.pop()
    }
    return found
  }
}

export function decodeFingerprints(bytes: ArrayBuffer | Uint8Array): FingerprintIndex {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const bad = (): never => {
    throw new Error('Not a fingerprint file')
  }
  if (u8.length < HEADER || MAGIC.some((m, i) => u8[i] !== m)) return bad()
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (view.getUint8(4) !== VERSION || view.getUint16(5, true) !== BITS) return bad()
  const count = view.getUint32(7, true)
  if (u8.length !== HEADER + count * RECORD) return bad()
  const ids = new Uint32Array(count)
  const hashes = new Uint32Array(count * HASH_WORDS)
  for (let i = 0; i < count; i++) {
    const o = HEADER + i * RECORD
    ids[i] = view.getUint32(o, true)
    for (let w = 0; w < HASH_WORDS; w++)
      hashes[i * HASH_WORDS + w] = view.getUint32(o + 4 + w * 4, true)
  }
  return new FingerprintIndex(ids, hashes)
}
