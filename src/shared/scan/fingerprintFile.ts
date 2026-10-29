import { HASH_WORDS, hamming } from './fingerprint'

// Format v1, little-endian: "DBFP", u8 version, u16 bits, u32 count,
// then per record u32 imageId + 32 hash bytes, sorted by imageId. An id may repeat: a printing
// scan of that artwork, kept as a second reference to it. Format v2 is the same with a u64 id
// (low u32, high u32), written only when some id does not fit 32 bits (Pokémon image ids).
const MAGIC = [0x44, 0x42, 0x46, 0x50]
const MAX_U32 = 0xffffffff
const BITS = HASH_WORDS * 32
const HEADER = 11
const hashBytes = HASH_WORDS * 4
const idBytes = (version: number): number => (version === 2 ? 8 : 4)

export function encodeFingerprints(entries: { imageId: number; hash: Uint32Array }[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.imageId - b.imageId)
  const version = sorted.some((e) => e.imageId > MAX_U32) ? 2 : 1
  const record = idBytes(version) + hashBytes
  const out = new Uint8Array(HEADER + sorted.length * record)
  const view = new DataView(out.buffer)
  out.set(MAGIC, 0)
  view.setUint8(4, version)
  view.setUint16(5, BITS, true)
  view.setUint32(7, sorted.length, true)
  sorted.forEach((e, i) => {
    const o = HEADER + i * record
    view.setUint32(o, e.imageId % 2 ** 32, true)
    if (version === 2) view.setUint32(o + 4, Math.floor(e.imageId / 2 ** 32), true)
    for (let w = 0; w < HASH_WORDS; w++)
      view.setUint32(o + idBytes(version) + w * 4, e.hash[w], true)
  })
  return out
}

export class FingerprintIndex {
  readonly count: number
  private readonly ids: Float64Array
  private readonly hashes: Uint32Array

  constructor(ids: Float64Array, hashes: Uint32Array) {
    this.count = ids.length
    this.ids = ids
    this.hashes = hashes
  }

  /**
   * The k closest images by Hamming distance, closest first, optionally limited to candidates. An
   * image id the file holds more than once is given once, at its closest.
   */
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
      // An artwork with several references (its card art and printing scans) counts once.
      const same = found.findIndex((f) => f.imageId === imageId)
      if (same >= 0) {
        if (found[same].distance <= distance) continue
        found.splice(same, 1)
      }
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
  const version = view.getUint8(4)
  if ((version !== 1 && version !== 2) || view.getUint16(5, true) !== BITS) return bad()
  const count = view.getUint32(7, true)
  const idSize = idBytes(version)
  const record = idSize + hashBytes
  if (u8.length !== HEADER + count * record) return bad()
  const ids = new Float64Array(count)
  const hashes = new Uint32Array(count * HASH_WORDS)
  for (let i = 0; i < count; i++) {
    const o = HEADER + i * record
    ids[i] = view.getUint32(o, true) + (version === 2 ? view.getUint32(o + 4, true) * 2 ** 32 : 0)
    for (let w = 0; w < HASH_WORDS; w++)
      hashes[i * HASH_WORDS + w] = view.getUint32(o + idSize + w * 4, true)
  }
  return new FingerprintIndex(ids, hashes)
}
