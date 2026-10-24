import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { PACK_ART_PREFIX } from '../konami/packArt'
import { createLimiter, type Limiter } from './limiter'

/** 'cropped' is the artwork alone, without the card frame. */
export type ImageSize = 'small' | 'full' | 'cropped'

const IMAGE_FOLDER: Record<ImageSize, string> = {
  small: 'cards_small',
  full: 'cards',
  cropped: 'cards_cropped'
}

export function imageUrl(size: ImageSize, id: number): string {
  return `https://images.ygoprodeck.com/images/${IMAGE_FOLDER[size]}/${id}.jpg`
}

/** Parses `ygo-img://<size>/<id>`; null for unknown sizes or ids that aren't positive integers. */
export function parseImageUrl(url: string): { size: ImageSize; id: number } | null {
  const m = /^ygo-img:\/\/(small|full|cropped)\/(\d+)\/?$/.exec(url)
  if (!m) return null
  const id = Number(m[2])
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return { size: m[1] as ImageSize, id }
}

const SET_KEY_RE = /^[A-Za-z0-9_-]+$/
const SET_IMAGE_RE = /^https:\/\/images\.ygoprodeck\.com\/images\/sets\/([A-Za-z0-9_-]+)\.jpg$/

/** Stem of a YGOPRODeck set-image URL; null for anything outside that folder. */
export function setImageKey(sourceUrl: string | null): string | null {
  if (sourceUrl === null) return null
  return SET_IMAGE_RE.exec(sourceUrl)?.[1] ?? null
}

const YUGIPEDIA_IMAGE_PREFIX = 'https://ms.yugipedia.com/'
const REPO_URL = 'https://github.com/darkharasho/yugioh-collection-tracker'

/** 'yp-' + first 20 hex chars of sha1(url); null unless url starts with https://ms.yugipedia.com/ */
export function yugipediaImageKey(url: string | null): string | null {
  if (url === null || !url.startsWith(YUGIPEDIA_IMAGE_PREFIX)) return null
  return `yp-${createHash('sha1').update(url).digest('hex').slice(0, 20)}`
}

const TCGPLAYER_IMAGE_RE = /^https:\/\/tcgplayer-cdn\.tcgplayer\.com\/product\/\d+_in_1000x1000\.jpg$/

/** Cache key of a printing photo: Yugipedia scans as for set images, TCGplayer photos as 'tp-'. */
export function printingImageKey(url: string | null): string | null {
  if (url !== null && TCGPLAYER_IMAGE_RE.test(url))
    return `tp-${createHash('sha1').update(url).digest('hex').slice(0, 20)}`
  return yugipediaImageKey(url)
}

export function setImageUrl(key: string): string {
  return `https://images.ygoprodeck.com/images/sets/${key}.jpg`
}

/** Parses `ygo-img://set/<key>`; null when the key has characters outside the allowed set. */
export function parseSetImageUrl(url: string): string | null {
  return /^ygo-img:\/\/set\/([A-Za-z0-9_-]+)\/?$/.exec(url)?.[1] ?? null
}

/** Parses `ygo-img://printing/<id>`; null unless the id is a positive integer. */
export function parsePrintingImageUrl(url: string): number | null {
  const m = /^ygo-img:\/\/printing\/(\d+)\/?$/.exec(url)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export interface ImageCache {
  get(size: ImageSize, id: number): Promise<string | null>
  getSet(key: string): Promise<string | null>
  /** The scan of one printing (from Yugipedia); null when it has none. */
  getPrinting(printingId: number): Promise<string | null>
  sizeBytes(): Promise<number>
  clear(): Promise<void>
}

const IMAGE_TIMEOUT_MS = 30_000

export const defaultLimiter = (): Limiter => createLimiter({ concurrency: 4, minIntervalMs: 100 })

export function createImageCache(opts: {
  dir: string
  fetchFn?: typeof fetch
  limit?: Limiter
  /** App version, sent in the Yugipedia User-Agent. */
  version?: string
  /** Maps a `yp-` (Yugipedia) or `yc-` (official site) set-image key to its source URL (null when unknown). */
  resolveSetImage?: (key: string) => string | null
  /** Finds the photo URL of a printing, Yugipedia or TCGplayer (null when none). */
  resolvePrintingArt?: (printingId: number) => Promise<string | null>
}): ImageCache {
  const fetchFn = opts.fetchFn ?? fetch
  const limit = opts.limit ?? defaultLimiter()
  const inFlight = new Map<string, Promise<string | null>>()

  const exists = (p: string): Promise<boolean> =>
    fs.stat(p).then((s) => s.isFile() && s.size > 0, () => false)

  async function download(remoteUrl: string, finalPath: string, headers?: Record<string, string>): Promise<string | null> {
    const tmpPath = `${finalPath}.tmp`
    try {
      await fs.mkdir(path.dirname(finalPath), { recursive: true })
      const res = await fetchFn(remoteUrl, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), ...(headers && { headers }) })
      if (!res.ok || !res.body) return null
      if (!(res.headers.get('content-type') ?? '').toLowerCase().startsWith('image/')) return null
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(tmpPath))
      if ((await fs.stat(tmpPath)).size === 0) throw new Error('empty image body')
      await fs.rename(tmpPath, finalPath)
      return finalPath
    } catch {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined)
      return null
    }
  }

  async function cached(
    key: string,
    remoteUrl: string,
    finalPath: string,
    headers?: Record<string, string>
  ): Promise<string | null> {
    if (await exists(finalPath)) return finalPath
    let pending = inFlight.get(key)
    if (!pending) {
      pending = limit(() => download(remoteUrl, finalPath, headers)).finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    return pending
  }

  return {
    get: (size, id) => cached(`${size}/${id}`, imageUrl(size, id), path.join(opts.dir, size, `${id}.jpg`)),

    async getSet(key) {
      if (!SET_KEY_RE.test(key)) return null
      if (key.startsWith('yp-') || key.startsWith('yc-')) {
        let remote: string | null
        try {
          remote = opts.resolveSetImage?.(key) ?? null
        } catch {
          return null // e.g. the database is closed or busy; never reject the protocol handler
        }
        const prefix = key.startsWith('yp-') ? YUGIPEDIA_IMAGE_PREFIX : PACK_ART_PREFIX
        if (remote === null || !remote.startsWith(prefix)) return null
        return cached(`set/${key}`, remote, path.join(opts.dir, 'sets', `${key}.jpg`), {
          'User-Agent': `YugiohCollectionTracker/${opts.version ?? 'unknown'} (${REPO_URL})`
        })
      }
      return cached(`set/${key}`, setImageUrl(key), path.join(opts.dir, 'sets', `${key}.jpg`))
    },

    async getPrinting(printingId) {
      let remote: string | null
      try {
        remote = (await opts.resolvePrintingArt?.(printingId)) ?? null
      } catch {
        return null
      }
      const key = printingImageKey(remote)
      if (remote === null || key === null) return null
      const ext = /\.(png|jpe?g|gif|webp)$/i.exec(remote)?.[1]?.toLowerCase() ?? 'png'
      return cached(`printing/${key}`, remote, path.join(opts.dir, 'printings', `${key}.${ext}`), {
        'User-Agent': `YugiohCollectionTracker/${opts.version ?? 'unknown'} (${REPO_URL})`
      })
    },

    async sizeBytes() {
      let total = 0
      const walk = async (d: string): Promise<void> => {
        let entries
        try {
          entries = await fs.readdir(d, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          const p = path.join(d, e.name)
          if (e.isDirectory()) await walk(p)
          else if (e.isFile()) total += (await fs.stat(p).catch(() => null))?.size ?? 0
        }
      }
      await walk(opts.dir)
      return total
    },

    async clear() {
      await fs.rm(opts.dir, { recursive: true, force: true })
    },
  }
}
