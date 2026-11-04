/**
 * One Piece card art for the nightly catalog job: hashes of Bandai's and TCGplayer's pictures (for
 * matching a TCGplayer product to a Bandai printing), the portal's full and small copies of
 * Bandai's art, and the guard that freezes a printing whose Bandai art changed.
 *
 * Art is judged by its hash, not its bytes: a re-encoded copy of the same picture is not a change.
 */
import { onePieceImageId } from '../../../src/shared/games/ids'
import { artHash, hamming, HASH_WORDS } from '../../../src/shared/scan/fingerprint'
import { hashHex } from '../../../src/shared/scan/fingerprintRefs'
import type { RgbaImage } from '../../../src/shared/scan/types'
import { decodeImage } from '../references'
import { smallJpeg } from '../thumbs'
import { HttpError, withRetry } from '../upload'
import type { OpCache } from './cache'
import type { OnePieceSources } from './sources'
import type { OpProduct } from './tcgcsv'
import type { BandaiEntry } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
/** A TCGplayer picture this close to a Bandai one is a match (Task 5 uses these). */
export const MATCH_MAX = 24
/** The runner-up must be this much further away than the match. */
export const MATCH_MARGIN = 40
/** Art this close to the stored hash is the same art, re-encoded. */
export const SAME_ART_MAX = 24
/** Downloads per night. */
export const ART_BUDGET = 3000
/** How often an entry's art is looked at again. */
export const RECHECK_MS = 14 * DAY_MS
/**
 * When the portal's full-size limit went from 2 MiB to 4 MiB (OP02's PNGs are about 2.3 MB). Art
 * refused as too large before then is tried again the next night, not at its re-check.
 */
export const FULL_LIMIT_RAISED_AT = Date.UTC(2026, 10, 4, 18)
/** Images in flight at once within a download run. */
const CONCURRENCY = 2

/** The inverse of hashHex. */
export function hexHash(s: string): Uint32Array {
  const out = new Uint32Array(HASH_WORDS)
  for (let w = 0; w < HASH_WORDS; w++) {
    let v = 0
    for (let b = 0; b < 4; b++) v |= parseInt(s.slice((w * 4 + b) * 2, (w * 4 + b) * 2 + 2), 16) << (b * 8)
    out[w] = v >>> 0
  }
  return out
}

/** The number of bits two hex hashes differ in. */
export function distance(a: string, b: string): number {
  return hamming(hexHash(a), 0, hexHash(b), 0)
}

/**
 * A JPEG small copy of Bandai's PNG. The card's rounded corners are transparent, and a JPEG
 * would turn them black, so each see-through pixel takes the first opaque pixel of its row.
 * Null when the PNG can't be decoded or the copy is over the Worker's limit.
 */
export function smallCopy(png: Uint8Array): Uint8Array | null {
  const img = decodeImage(png)
  if (!img || img.width <= 0 || img.height <= 0) return null
  const data = new Uint8Array(img.data)
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width * 4
    let first = -1
    for (let x = 0; x < img.width; x++) {
      if (data[row + x * 4 + 3] === 255) {
        first = row + x * 4
        break
      }
    }
    for (let x = 0; x < img.width; x++) {
      const i = row + x * 4
      if (data[i + 3] === 255) continue
      if (first >= 0) {
        data[i] = data[first]
        data[i + 1] = data[first + 1]
        data[i + 2] = data[first + 2]
      }
      data[i + 3] = 255
    }
  }
  const filled: RgbaImage = { width: img.width, height: img.height, data }
  return smallJpeg(filled)
}

export interface ArtPortal {
  url: string
  token: string
  fetch?: typeof fetch
  /** Per-request limit; defaults to UPLOAD_TIMEOUT_MS. */
  timeoutMs?: number
}

/** One PUT's limit; one that runs over is a failed attempt and retried. */
export const UPLOAD_TIMEOUT_MS = 60_000

/** PUTs one stored copy of an entry's art to the portal. */
export async function uploadArt(o: ArtPortal, size: 'full' | 'small', imageId: number, bytes: Uint8Array): Promise<void> {
  const path = `/api/admin/op-art/${size}/${imageId}`
  const fetchFn = o.fetch ?? fetch
  await withRetry(path, async () => {
    const res = await fetchFn(`${o.url.replace(/\/+$/, '')}${path}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${o.token}`, 'content-type': size === 'full' ? 'image/png' : 'image/jpeg' },
      body: bytes as Uint8Array<ArrayBuffer>,
      signal: AbortSignal.timeout(o.timeoutMs ?? UPLOAD_TIMEOUT_MS)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(res.status, `${path} failed: HTTP ${res.status} ${text}`.trim())
    }
  })
}

/**
 * True when the entry's Bandai art changed after it was first hashed. A frozen entry keeps its
 * old hash, is never uploaded and is only re-checked fortnightly. A human clears a freeze by
 * deleting that `bandai_art` row, which leads to a fresh hash and a re-upload.
 */
export function isFrozen(cache: OpCache, bandaiId: string): boolean {
  return cache.getBandaiArt(bandaiId)?.changedHash != null
}

/** One series' entries and the products its numbers may match (its mapped group's, or the promo pool's). */
export interface ArtBatch {
  seriesId: string
  entries: BandaiEntry[]
  candidates: OpProduct[]
}

export interface ArtResult {
  fetched: number
  failed: number
  uploaded: number
  changed: string[]
  firstNoticed: string[]
  /** Entries the portal refused as too large for the first time tonight. */
  tooLarge: string[]
}

export interface RefreshArtOptions {
  cache: OpCache
  sources: OnePieceSources
  /** Newest series first. */
  batches: ArtBatch[]
  /** bandaiId to the product id already on its printing. */
  stored: Map<string, number>
  /** Absent on a dry run: nothing is uploaded. */
  portal?: ArtPortal
  now: number
  log: (line: string) => void
  budget?: number
  /** The card list's region, which the uploaded image ids are in; 'en' by default. */
  region?: string
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const run = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run))
}

/** Art no copy of which fits the portal's limits. */
class TooLarge extends Error {}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Hashes new art, uploads what the portal lacks and re-checks old art, within tonight's download budget. */
export async function refreshArt(o: RefreshArtOptions): Promise<ArtResult> {
  const { cache, sources, now, log } = o
  const region = o.region ?? 'en'
  const result: ArtResult = { fetched: 0, failed: 0, uploaded: 0, changed: [], firstNoticed: [], tooLarge: [] }
  let left = o.budget ?? ART_BUDGET
  /** Takes up to `items.length` downloads out of what is left of the budget. */
  const spend = <T>(items: T[]): T[] => {
    const take = items.slice(0, Math.max(0, left))
    left -= take.length
    return take
  }
  const fail = (what: string, e: unknown): void => {
    result.failed++
    log(`Art: ${what} failed: ${message(e)}`)
  }
  const entries = new Map<string, BandaiEntry>()
  for (const b of o.batches) for (const e of b.entries) if (!entries.has(e.bandaiId)) entries.set(e.bandaiId, e)
  const ordered = [...entries.values()]

  /**
   * Puts both copies of an entry's art on the portal and stamps `stored_at`; the bytes are not kept.
   * Art too large for the portal is stamped `too_large_at`, so step 2 leaves it until RECHECK_MS on.
   */
  const store = async (portal: ArtPortal, id: string, bytes: Uint8Array): Promise<void> => {
    try {
      // The PNG decoded before this, so no small copy means none fits under the limit.
      const small = smallCopy(bytes)
      if (!small) throw new TooLarge('no small copy under 200 KiB')
      await uploadArt(portal, 'full', onePieceImageId(region, id), bytes)
      await uploadArt(portal, 'small', onePieceImageId(region, id), small)
    } catch (e) {
      if (e instanceof TooLarge || (e instanceof HttpError && e.status === 413)) {
        const row = cache.getBandaiArt(id)!
        if (row.tooLargeAt === null) result.tooLarge.push(id)
        cache.putBandaiArt({ ...row, tooLargeAt: now })
      }
      throw e
    }
    cache.putBandaiArt({ ...cache.getBandaiArt(id)!, storedAt: now, tooLargeAt: null })
    result.uploaded++
  }

  /** Records art that differs from the stored hash: the stored hash stays. */
  const noteChange = (id: string, hash: string): void => {
    const row = cache.getBandaiArt(id)!
    const first = row.notedAt === null
    cache.putBandaiArt({
      ...row, checkedAt: now, changedHash: hash, notedAt: row.notedAt ?? now
    })
    result.changed.push(id)
    if (first) {
      result.firstNoticed.push(id)
      log(`Art: ${id} changed on Bandai; frozen`)
    }
  }

  // 1. New art, batch by batch.
  for (const batch of o.batches) {
    if (left <= 0) break
    const newEntries = batch.entries.filter((e) => !cache.getBandaiArt(e.bandaiId))
    await pool(spend(newEntries), async (e) => {
      try {
        const got = await sources.bandaiImage(e.bandaiId)
        result.fetched++
        if (!got) throw new Error('no image returned')
        const img = decodeImage(got.bytes)
        if (!img) throw new Error('not a PNG or JPEG')
        cache.putBandaiArt({
          bandaiId: e.bandaiId, hash: hashHex(artHash(img)), lastModified: got.lastModified, checkedAt: now,
          storedAt: null, changedHash: null, notedAt: null, tooLargeAt: null
        })
        // Uploaded at once, so at most CONCURRENCY images are held at a time.
        if (o.portal) await store(o.portal, e.bandaiId, got.bytes)
      } catch (err) {
        fail(`Bandai image ${e.bandaiId} (hash or upload)`, err)
      }
    })

    // TCGplayer: every candidate of a number with an entry that has no product yet, and each stored product with no hash.
    const wanted = new Map<number, OpProduct>()
    const needed = new Set(batch.entries.filter((e) => !o.stored.has(e.bandaiId)).map((e) => e.number))
    for (const p of batch.candidates) if (p.number !== null && needed.has(p.number)) wanted.set(p.productId, p)
    for (const e of batch.entries) {
      const pid = o.stored.get(e.bandaiId)
      const p = pid === undefined ? undefined : batch.candidates.find((c) => c.productId === pid)
      if (p) wanted.set(p.productId, p)
    }
    const toFetch = [...wanted.values()].filter(
      (p) => p.imageUrl !== null && cache.getTcgArt(p.productId)?.imageUrl !== p.imageUrl
    )
    await pool(spend(toFetch), async (p) => {
      try {
        const bytes = await sources.tcgImage(p.imageUrl!)
        result.fetched++
        const img = decodeImage(bytes)
        if (!img) throw new Error('not a PNG or JPEG')
        cache.putTcgArt({ productId: p.productId, imageUrl: p.imageUrl!, hash: hashHex(artHash(img)), fetchedAt: now })
      } catch (err) {
        fail(`TCGplayer image ${p.productId}`, err)
      }
    })
  }

  // 2. Uploads.
  if (o.portal) {
    const portal = o.portal
    // Only entries from earlier nights: tonight's failed uploads wait for tomorrow. Art the portal
    // refused as too large waits for its re-check.
    const pending = ordered.filter((e) => {
      const row = cache.getBandaiArt(e.bandaiId)
      return (
        row !== null && row.storedAt === null && row.changedHash === null && row.checkedAt < now &&
        (row.tooLargeAt === null || row.tooLargeAt < FULL_LIMIT_RAISED_AT || now - row.tooLargeAt > RECHECK_MS)
      )
    })
    // Left from an earlier night: downloaded again, which costs budget; without budget it waits.
    const todo = spend(pending)
    await pool(todo, async (e) => {
      const id = e.bandaiId
      try {
        const got = await sources.bandaiImage(id)
        result.fetched++
        if (!got) throw new Error('no image returned')
        const img = decodeImage(got.bytes)
        if (!img) throw new Error('not a PNG or JPEG')
        const row = cache.getBandaiArt(id)!
        const hash = hashHex(artHash(img))
        if (distance(hash, row.hash) > SAME_ART_MAX) {
          noteChange(id, hash)
          return
        }
        cache.putBandaiArt({ ...row, hash, lastModified: got.lastModified ?? row.lastModified, checkedAt: now })
        await store(portal, id, got.bytes)
      } catch (err) {
        fail(`art upload ${id}`, err)
      }
    })
  }

  // 3. Re-checks, oldest first.
  const due = ordered
    .map((e) => cache.getBandaiArt(e.bandaiId))
    .filter((r): r is NonNullable<typeof r> => r !== null && now - r.checkedAt > RECHECK_MS)
    .sort((a, b) => a.checkedAt - b.checkedAt)
  await pool(spend(due), async (row) => {
    const id = row.bandaiId
    try {
      const got = await sources.bandaiImage(id, row.lastModified ?? undefined)
      result.fetched++
      if (!got) {
        cache.putBandaiArt({ ...cache.getBandaiArt(id)!, checkedAt: now })
        return
      }
      const img = decodeImage(got.bytes)
      if (!img) throw new Error('not a PNG or JPEG')
      const hash = hashHex(artHash(img))
      if (distance(hash, row.hash) <= SAME_ART_MAX) {
        cache.putBandaiArt({ ...cache.getBandaiArt(id)!, hash, lastModified: got.lastModified ?? row.lastModified, checkedAt: now })
      } else {
        noteChange(id, hash)
      }
    } catch (err) {
      fail(`Bandai re-check ${id}`, err)
    }
  })

  return result
}
