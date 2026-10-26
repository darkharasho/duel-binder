import Database from 'better-sqlite3'
import { decode } from 'jpeg-js'
import { imageUrl } from '../../src/shared/imageSources'
import { HASH_WORDS, artHash } from '../../src/shared/scan/fingerprint'
import { encodeFingerprints } from '../../src/shared/scan/fingerprintFile'

const DEFAULT_CONCURRENCY = 6
const COMMIT_EVERY = 200
/** Waits before each retry; an image is tried once plus once per entry. */
const RETRY_DELAYS_MS = [1000, 2000]

export interface FingerprintOptions {
  /** The work database; its `card_images` decides which ids the file holds. */
  work: Database.Database
  /** SQLite file caching one hash per image id, so each night fetches only new images. */
  cachePath: string
  fetch?: typeof fetch
  concurrency?: number
  log?: (s: string) => void
}

export interface FingerprintResult {
  bytes: Uint8Array
  fetched: number
  failed: number
  count: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Downloads and hashes one cropped art image; 429 and 5xx are retried, anything else rejects. */
async function hashImage(fetchFn: typeof fetch, id: number): Promise<Uint32Array> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(imageUrl('cropped', id))
    if (res.ok) {
      const img = decode(new Uint8Array(await res.arrayBuffer()), {
        useTArray: true,
        formatAsRGBA: true
      })
      return artHash(img)
    }
    await res.body?.cancel()
    const retry = res.status === 429 || res.status >= 500
    if (!retry || attempt >= RETRY_DELAYS_MS.length) throw new Error(`HTTP ${res.status}`)
    await sleep(RETRY_DELAYS_MS[attempt])
  }
}

/**
 * Builds the scan fingerprint file for every `card_images` id in `work`. Hashes already in the
 * cache are reused; the rest are downloaded and hashed, and an image that fails is skipped
 * (and counted) so it is tried again next run.
 */
export async function buildFingerprints(opts: FingerprintOptions): Promise<FingerprintResult> {
  const fetchFn = opts.fetch ?? fetch
  const log = opts.log ?? ((): void => {})
  const cache = new Database(opts.cachePath)
  try {
    cache.exec('CREATE TABLE IF NOT EXISTS fp (image_id INTEGER PRIMARY KEY, hash BLOB NOT NULL)')
    // A truncated or foreign blob would corrupt the file; drop it so it is fetched again.
    cache.prepare('DELETE FROM fp WHERE length(hash) != ?').run(HASH_WORDS * 4)
    const cached = new Set(cache.prepare('SELECT image_id FROM fp').pluck().all() as number[])
    const ids = opts.work.prepare('SELECT image_id FROM card_images').pluck().all() as number[]
    const todo = ids.filter((id) => !cached.has(id))
    const insert = cache.prepare('INSERT OR REPLACE INTO fp (image_id, hash) VALUES (?, ?)')
    // Commit every few inserts rather than per row, but often enough that a run cut off by the
    // timeout keeps its progress.
    let pending = 0
    cache.exec('BEGIN')

    let fetched = 0
    let failed = 0
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const id = todo[next++]
        try {
          const hash = await hashImage(fetchFn, id)
          insert.run(id, Buffer.from(hash.buffer, hash.byteOffset, hash.byteLength))
          fetched++
          if (++pending >= COMMIT_EVERY) {
            cache.exec('COMMIT; BEGIN')
            pending = 0
          }
        } catch (e) {
          failed++
          log(`Fingerprint for image ${id} failed: ${e instanceof Error ? e.message : e}`)
        }
      }
    }
    const workers = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)
    await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, worker))

    cache.exec('COMMIT')

    const idSet = new Set(ids)
    const entries: { imageId: number; hash: Uint32Array }[] = []
    for (const row of cache.prepare('SELECT image_id, hash FROM fp ORDER BY image_id').all() as {
      image_id: number
      hash: Buffer
    }[]) {
      if (!idSet.has(row.image_id)) continue
      // Copy: a Buffer's bytes may sit at an unaligned offset in a shared pool.
      const bytes = new Uint8Array(row.hash)
      entries.push({ imageId: row.image_id, hash: new Uint32Array(bytes.buffer) })
    }
    return { bytes: encodeFingerprints(entries), fetched, failed, count: entries.length }
  } finally {
    cache.close()
  }
}

export interface UploadFingerprintsOptions {
  url: string
  token: string
  bytes: Uint8Array
  fetch?: typeof fetch
}

/** PUTs the fingerprint file to the portal and returns the count it stored. */
export async function uploadFingerprints(opts: UploadFingerprintsOptions): Promise<number> {
  const fetchFn = opts.fetch ?? fetch
  const path = '/admin/scan/fingerprints'
  const res = await fetchFn(`${opts.url.replace(/\/+$/, '')}${path}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${opts.token}`,
      'content-type': 'application/octet-stream'
    },
    body: opts.bytes as BodyInit
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${path} failed: HTTP ${res.status} ${text}`.trim())
  }
  return ((await res.json()) as { count: number }).count
}
