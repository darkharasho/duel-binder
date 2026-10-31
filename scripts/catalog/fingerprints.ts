import Database from 'better-sqlite3'
import { decode } from 'jpeg-js'
import type { GameId } from '../../src/shared/games'
import { imageUrl } from '../../src/shared/imageSources'
import { scanProfile, type ScanProfile } from '../../src/shared/scan/profiles'
import { HASH_WORDS, artHash, fingerprintSource, hamming } from '../../src/shared/scan/fingerprint'
import { encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { encodeFingerprintRefs } from '../../src/shared/scan/fingerprintRefs'
import { isTokenId, TOKEN_ID_MIN } from '../../src/shared/games/ids'
import type { YugipediaClient } from '../../src/main/yugipedia/client'
import {
  buildReferences,
  decodeImage,
  download,
  scanHash,
  type ReferenceOptions,
  type ReferenceResult
} from './references'

const DEFAULT_CONCURRENCY = 6
const COMMIT_EVERY = 200
/** Waits before each retry; an image is tried once plus once per entry. */
const RETRY_DELAYS_MS = [1000, 2000]
/**
 * Bump when the way an image is hashed changes; v2 hashes only the visible top of Pendulum art, v3
 * keeps Pendulum crops already cut to the visible window whole.
 */
const HASH_VERSION = '3'
/** Pokémon's own cache file has its own version: bump when the full-card crop changes. */
const PKM_HASH_VERSION = '1'
/**
 * A token with a hash this close to another card's gets no records. Its art is often that card's,
 * and a whole-card scan sits nearer a photo than the art crop does, so it would win the match in
 * apps already shipped. Such a token is still scanned by its printed code.
 */
const TOKEN_MIN_DISTANCE = 80

export interface FingerprintOptions {
  /** The work database; the game's `card_images` decide which ids the file holds. */
  work: Database.Database
  /**
   * SQLite file caching one hash per image id, so each night fetches only new images. Pokémon
   * needs a file of its own (`fingerprints-pkm.sqlite`): its version and ids are its own.
   */
  cachePath: string
  /** Which game's file to build; Yu-Gi-Oh without it. */
  game?: GameId
  fetch?: typeof fetch
  concurrency?: number
  log?: (s: string) => void
  /** Adds Yugipedia printing scans as extra references (see buildReferences); none without it. */
  references?: Omit<ReferenceOptions, 'work' | 'cache' | 'log'>
  /** Finds the scans of token ids, which YGOPRODeck has no art for; they are left out without it. */
  tokenArt?: Pick<YugipediaClient, 'imageUrlsByPageId'>
}

export interface FingerprintResult {
  bytes: Uint8Array
  /** The refs file that goes with it: which printings its printing scans show (fingerprintRefs.ts). */
  refs: Uint8Array
  fetched: number
  failed: number
  /** Every hash in the file, printing scans included. */
  count: number
  /** Printing scans in the file, and how many were downloaded or failed this run. */
  references: { count: number; fetched: number; failed: number }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Downloads and hashes one cropped art image; 429 and 5xx are retried, anything else rejects. */
async function hashImage(
  fetchFn: typeof fetch,
  url: string,
  frameType: string,
  profile?: ScanProfile
): Promise<Uint32Array> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url)
    if (res.ok) {
      const img = decode(new Uint8Array(await res.arrayBuffer()), {
        useTArray: true,
        formatAsRGBA: true
      })
      return artHash(fingerprintSource(img, frameType, profile))
    }
    await res.body?.cancel()
    const retry = res.status === 429 || res.status >= 500
    if (!retry || attempt >= RETRY_DELAYS_MS.length) throw new Error(`HTTP ${res.status}`)
    await sleep(RETRY_DELAYS_MS[attempt])
  }
}

/**
 * TCGdex serves a card's image at `${base}/low.jpg` (jpeg-js can't read its webp default); a
 * TCGplayer image is already a full `_200w.jpg` URL.
 */
function pokemonImageUrl(base: string): string {
  return base.includes('tcgplayer-cdn') ? base : `${base}/low.jpg`
}

/**
 * The token cards with a record within TOKEN_MIN_DISTANCE of a record of any other card, tokens
 * included, so two tokens close to each other are both in it.
 */
function tooCloseTokens(
  records: { imageId: number; hash: Uint32Array }[],
  cardOf: ReadonlyMap<number, number>
): Set<number> {
  const out = new Set<number>()
  for (const token of records) {
    if (!isTokenId(token.imageId)) continue
    const card = cardOf.get(token.imageId)!
    if (out.has(card)) continue
    const close = records.some(
      (r) =>
        cardOf.get(r.imageId) !== card && hamming(token.hash, 0, r.hash, 0) <= TOKEN_MIN_DISTANCE
    )
    if (close) out.add(card)
  }
  return out
}

/**
 * Builds the scan fingerprint file for every `card_images` id of the game in `work`: Yu-Gi-Oh
 * from YGOPRODeck's cropped art, Pokémon from the full-card renders (cut to the art box by
 * fingerprintSource) with no printing scans. Hashes already in the
 * cache are reused; the rest are downloaded and hashed, and an image that fails is skipped
 * (and counted) so it is tried again next run. Tokens too like another card are left out of the
 * finished set of records (see TOKEN_MIN_DISTANCE), however their hashes were come by.
 */
export async function buildFingerprints(opts: FingerprintOptions): Promise<FingerprintResult> {
  const fetchFn = opts.fetch ?? fetch
  const log = opts.log ?? ((): void => {})
  const game = opts.game ?? 'ygo'
  const pkm = game === 'pkm'
  const profile = pkm ? scanProfile('pkm') : undefined
  const hashVersion = pkm ? PKM_HASH_VERSION : HASH_VERSION
  const cache = new Database(opts.cachePath)
  try {
    cache.exec('CREATE TABLE IF NOT EXISTS fp (image_id INTEGER PRIMARY KEY, hash BLOB NOT NULL)')
    // A truncated or foreign blob would corrupt the file; drop it so it is fetched again.
    cache.prepare('DELETE FROM fp WHERE length(hash) != ?').run(HASH_WORDS * 4)
    const images = opts.work
      .prepare(
        `SELECT i.image_id, i.card_id, COALESCE(c.frame_type, '') AS frame_type
         FROM card_images i LEFT JOIN cards c ON c.id = i.card_id
         WHERE i.game = ?`
      )
      .all(game) as { image_id: number; card_id: number; frame_type: string }[]
    const frames = new Map(images.map((r) => [r.image_id, r.frame_type]))
    const cardOf = new Map(images.map((r) => [r.image_id, r.card_id]))
    cache.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const version = cache.prepare("SELECT value FROM meta WHERE key = 'hash_version'").pluck().get()
    if (version !== hashVersion) {
      // Older hashes are only still right for images known not to be Pendulum art (all are
      // stale for Pokémon, whose first version is the only one).
      const keep = (id: number): boolean =>
        !pkm && frames.has(id) && !frames.get(id)!.includes('pendulum')
      const stale = (cache.prepare('SELECT image_id FROM fp').pluck().all() as number[]).filter(
        (id) => !keep(id)
      )
      const drop = cache.prepare('DELETE FROM fp WHERE image_id = ?')
      cache.transaction(() => {
        for (const id of stale) drop.run(id)
        // Printing scans are hashed again too.
        cache.exec('DROP TABLE IF EXISTS ref_file')
        cache
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('hash_version', ?)")
          .run(hashVersion)
      })()
    }
    const cached = new Set(cache.prepare('SELECT image_id FROM fp').pluck().all() as number[])
    const ids = [...frames.keys()]
    const urls = new Map<number, string>()
    if (pkm) {
      for (const r of opts.work
        .prepare(
          `SELECT i.image_id, p.image_url FROM card_images i
           JOIN pokemon_cards p ON p.card_id = i.card_id WHERE i.game = 'pkm' AND p.image_url IS NOT NULL`
        )
        .all() as { image_id: number; image_url: string }[])
        urls.set(r.image_id, pokemonImageUrl(r.image_url))
      // Art taken off a card (it was another card's) takes its hash with it.
      const drop = cache.prepare('DELETE FROM fp WHERE image_id = ?')
      for (const id of [...cached].filter((x) => !urls.has(x))) {
        drop.run(id)
        cached.delete(id)
      }
    }
    const missing = ids.filter((id) => !cached.has(id))
    const todo = missing.filter((id) => !isTokenId(id))
    const tokens = missing.filter(isTokenId)
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
          const url = pkm ? urls.get(id) : imageUrl('cropped', id)
          if (!url) throw new Error('no image URL')
          const hash = await hashImage(fetchFn, url, frames.get(id)!, profile)
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

    // Token art is a Yugipedia scan of the whole card, cut as a photo is; one at a time, like the
    // printing scans from the same host.
    if (tokens.length > 0 && opts.tokenArt) {
      const userAgent = opts.references?.userAgent ?? 'DuelBinder'
      try {
        const art = await opts.tokenArt.imageUrlsByPageId(tokens.map((id) => id - TOKEN_ID_MIN))
        for (const id of tokens) {
          try {
            const url = art.get(id - TOKEN_ID_MIN)
            if (!url) throw new Error('no image URL')
            const img = decodeImage(await download(fetchFn, url, userAgent))
            const hash = img && scanHash(img, frames.get(id)!)
            if (!hash) throw new Error('not a card scan')
            insert.run(id, Buffer.from(hash.buffer, hash.byteOffset, hash.byteLength))
            fetched++
          } catch (e) {
            failed++
            log(`Fingerprint for image ${id} failed: ${e instanceof Error ? e.message : e}`)
          }
        }
      } catch (e) {
        failed += tokens.length
        log(`Token art lookup failed: ${e instanceof Error ? e.message : e}`)
      }
    }

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
    // Printing scans are extras: trouble with them is logged and leaves the card art file as is.
    const references = { count: 0, fetched: 0, failed: 0 }
    const scans: ReferenceResult['entries'] = []
    if (opts.references && !pkm) {
      try {
        const out = await buildReferences({ ...opts.references, work: opts.work, cache, log })
        scans.push(...out.entries.filter((e) => idSet.has(e.imageId)))
        Object.assign(references, { fetched: out.fetched, failed: out.failed })
      } catch (e) {
        log(`Printing scans failed: ${e instanceof Error ? e.message : e}`)
      }
    }
    const records = [...entries, ...scans.map(({ imageId, hash }) => ({ imageId, hash }))]
    const leftOut = tooCloseTokens(records, cardOf)
    if (leftOut.size > 0) {
      const name = opts.work.prepare('SELECT name FROM cards WHERE id = ?').pluck()
      const names = [...leftOut].map((id) => name.get(id)).join(', ')
      log(`Tokens left out of the fingerprints, too close to other art (${leftOut.size}): ${names}`)
    }
    const kept = (e: { imageId: number }): boolean => !leftOut.has(cardOf.get(e.imageId)!)
    const keptScans = scans.filter(kept)
    references.count = keptScans.length
    const finalRecords = records.filter(kept)
    return {
      bytes: encodeFingerprints(finalRecords),
      refs: encodeFingerprintRefs(keptScans.filter((e) => e.printings.length > 0)),
      fetched,
      failed,
      count: finalRecords.length,
      references
    }
  } finally {
    cache.close()
  }
}

export interface UploadFingerprintsOptions {
  url: string
  token: string
  bytes: Uint8Array
  game: GameId
  fetch?: typeof fetch
}

async function put(opts: UploadFingerprintsOptions, path: string, type: string): Promise<number> {
  const fetchFn = opts.fetch ?? fetch
  const query = opts.game === 'ygo' ? '' : `?game=${opts.game}`
  const res = await fetchFn(`${opts.url.replace(/\/+$/, '')}${path}${query}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${opts.token}`, 'content-type': type },
    body: opts.bytes as BodyInit
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${path} failed: HTTP ${res.status} ${text}`.trim())
  }
  return ((await res.json()) as { count: number }).count
}

/** PUTs the fingerprint file to the portal and returns the count it stored. */
export const uploadFingerprints = (opts: UploadFingerprintsOptions): Promise<number> =>
  put(opts, '/admin/scan/fingerprints', 'application/octet-stream')

/** PUTs the fingerprint refs file to the portal and returns the count of refs it stored. */
export const uploadFingerprintRefs = (
  opts: Omit<UploadFingerprintsOptions, 'game'>
): Promise<number> =>
  put({ ...opts, game: 'ygo' }, '/admin/scan/fingerprint-refs', 'application/json')
