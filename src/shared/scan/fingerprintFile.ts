import { HASH_WORDS, hamming } from './fingerprint'
import { hashHex, type RefMatch, type ScanRef } from './fingerprintRefs'

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

/**
 * An artwork's match. An artwork with reference scans of known printings (withRefs) also has its
 * best distance over its other records (`base`, its card art) and each of those scans' distances,
 * closest first, so the printing it looks most like can be told.
 */
export interface ArtMatch {
  imageId: number
  distance: number
  base?: number
  refs?: RefMatch[]
}

export class FingerprintIndex {
  readonly count: number
  private readonly ids: Float64Array
  private readonly hashes: Uint32Array
  /** The ref of each record that is a reference scan of known printings, by record. */
  private refOf = new Map<number, ScanRef>()
  /** The records of each artwork with such a reference scan. */
  private recordsOf = new Map<number, number[]>()

  constructor(ids: Float64Array, hashes: Uint32Array) {
    this.count = ids.length
    this.ids = ids
    this.hashes = hashes
  }

  /**
   * Tags the records that are reference scans of known printings (see fingerprintRefs.ts): those
   * whose image id and hash a ref names. Replaces any tagged before; resolves how many it tagged.
   */
  withRefs(refs: readonly ScanRef[]): number {
    this.refOf = new Map()
    this.recordsOf = new Map()
    const byKey = new Map<string, ScanRef>()
    for (const r of refs) {
      const key = `${r.imageId}:${r.h}`
      const had = byKey.get(key)
      byKey.set(
        key,
        had ? { ...had, printingIds: [...new Set([...had.printingIds, ...r.printingIds])] } : r
      )
    }
    const imageIds = new Set(refs.map((r) => r.imageId))
    for (let i = 0; i < this.count; i++) {
      const imageId = this.ids[i]
      if (!imageIds.has(imageId)) continue
      const records = this.recordsOf.get(imageId) ?? []
      records.push(i)
      this.recordsOf.set(imageId, records)
      const ref = byKey.get(
        `${imageId}:${hashHex(this.hashes.subarray(i * HASH_WORDS, (i + 1) * HASH_WORDS))}`
      )
      if (ref) this.refOf.set(i, ref)
    }
    for (const [imageId, records] of this.recordsOf)
      if (!records.some((i) => this.refOf.has(i))) this.recordsOf.delete(imageId)
    return this.refOf.size
  }

  /**
   * The same index holding only imageIds' records, for searching one language's art: nearest walks
   * every record it holds, while a candidates set still costs a lookup for each one left out.
   * Reference scans aren't carried over; only Yu-Gi-Oh has them, and it's never narrowed.
   */
  only(imageIds: ReadonlySet<number>): FingerprintIndex {
    const kept: number[] = []
    for (let i = 0; i < this.count; i++) if (imageIds.has(this.ids[i])) kept.push(i)
    const ids = new Float64Array(kept.length)
    const hashes = new Uint32Array(kept.length * HASH_WORDS)
    kept.forEach((record, i) => {
      ids[i] = this.ids[record]
      hashes.set(this.hashes.subarray(record * HASH_WORDS, (record + 1) * HASH_WORDS), i * HASH_WORDS)
    })
    return new FingerprintIndex(ids, hashes)
  }

  /**
   * The k closest images by Hamming distance, closest first, optionally limited to candidates. An
   * image id the file holds more than once is given once, at its closest, with its base and
   * reference scan distances when it has tagged reference scans (see ArtMatch).
   */
  nearest(hash: Uint32Array, k: number, candidates?: ReadonlySet<number>): ArtMatch[] {
    // One pass keeping the best k in order: this runs a few dozen times per camera frame.
    const found: ArtMatch[] = []
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
    // Only the few artworks found, and only those with reference scans, are looked at again.
    if (this.recordsOf.size === 0) return found
    return found.map((f) => {
      const records = this.recordsOf.get(f.imageId)
      if (!records) return f
      let base = Infinity
      const refs: RefMatch[] = []
      for (const i of records) {
        const distance = hamming(hash, 0, hashes, i * HASH_WORDS)
        const ref = this.refOf.get(i)
        if (ref) refs.push({ h: ref.h, printingIds: ref.printingIds, distance })
        else base = Math.min(base, distance)
      }
      refs.sort((a, b) => a.distance - b.distance)
      return Number.isFinite(base) ? { ...f, base, refs } : { ...f, refs }
    })
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
