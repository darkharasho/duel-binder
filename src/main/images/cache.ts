import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createLimiter, type Limiter } from './limiter'
import { POKEDEX_SIZE } from '../../shared/pokedex'
import { setImageKey } from '../../shared/setImages'
import {
  imageUrl,
  SET_KEY_RE,
  setImageUrl,
  YUGIPEDIA_IMAGE_PREFIX,
  type ImageSize
} from '../../shared/imageSources'
import type { ImageDownloads } from '../../shared/types'

export { imageUrl, setImageUrl, type ImageSize }

/** Parses `ygo-img://<size>/<id>`; null for unknown sizes or ids that aren't positive integers. */
export function parseImageUrl(url: string): { size: ImageSize; id: number } | null {
  const m = /^ygo-img:\/\/(small|full|cropped)\/(\d+)\/?(?:\?.*)?$/.exec(url)
  if (!m) return null
  const id = Number(m[2])
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return { size: m[1] as ImageSize, id }
}

export { setImageKey }

/** 'yp-' + first 20 hex chars of sha1(url); null unless url starts with https://ms.yugipedia.com/ */
export function yugipediaImageKey(url: string | null): string | null {
  if (url === null || !url.startsWith(YUGIPEDIA_IMAGE_PREFIX)) return null
  return `yp-${createHash('sha1').update(url).digest('hex').slice(0, 20)}`
}

const TCGPLAYER_IMAGE_RE =
  /^https:\/\/tcgplayer-cdn\.tcgplayer\.com\/product\/\d+_in_1000x1000\.jpg$/

/** Cache key of a printing photo: Yugipedia scans as for set images, TCGplayer photos as 'tp-'. */
export function printingImageKey(url: string | null): string | null {
  if (url !== null && TCGPLAYER_IMAGE_RE.test(url))
    return `tp-${createHash('sha1').update(url).digest('hex').slice(0, 20)}`
  return yugipediaImageKey(url)
}

/** Parses `ygo-img://set/<key>`; null when the key has characters outside the allowed set. */
export function parseSetImageUrl(url: string): string | null {
  return /^ygo-img:\/\/set\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/.exec(url)?.[1] ?? null
}

/** Parses `ygo-img://sprite/<n>`; null unless n is a national Pokédex number. */
export function parseSpriteImageUrl(url: string): number | null {
  const m = /^ygo-img:\/\/sprite\/([1-9]\d{0,3})\/?$/.exec(url)
  if (!m) return null
  const n = Number(m[1])
  return n <= POKEDEX_SIZE ? n : null
}

/** Parses `ygo-img://printing/<id>`; null unless the id is a positive integer. */
export function parsePrintingImageUrl(url: string): number | null {
  const m = /^ygo-img:\/\/printing\/(\d+)\/?$/.exec(url)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Parses `ygo-img://printing-small/<id>` (a grid tile's photo); null unless the id is a positive integer. */
export function parseSmallPrintingImageUrl(url: string): number | null {
  const m = /^ygo-img:\/\/printing-small\/(\d+)\/?$/.exec(url)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** A photo the server had no small copy of is asked about again after this. */
export const SMALL_RETRY_MS = 24 * 60 * 60 * 1000

export interface ImageCache {
  /** `priority` downloads it ahead of what's already queued (an image someone's waiting on). */
  get(size: ImageSize, id: number, opts?: { priority?: boolean }): Promise<string | null>
  getSet(key: string, opts?: { priority?: boolean }): Promise<string | null>
  /** A Pokédex sprite by national number; null when n is out of range or it can't be fetched. */
  getSprite(n: number): Promise<string | null>
  /**
   * The scan of one printing; null when it has none. `small`: its small copy for a grid, else the
   * full photo (already on disk, or while the server has no small copy).
   */
  getPrinting(printingId: number, opts?: { small?: boolean }): Promise<string | null>
  sizeBytes(): Promise<number>
  clear(): Promise<void>
}

/** Where one image is fetched from, and the headers that fetch carries. */
export interface ImageSource {
  url: string
  headers?: Record<string, string>
  /** Printings only: the file name (without extension) and in-flight key, stable across local row ids. */
  key?: string
}

/** Where each kind of image comes from; null answers mean "nothing to fetch" and are never cached. */
export interface ImageSources {
  card(size: ImageSize, id: number): ImageSource | null
  set(key: string): ImageSource | null
  konami(key: string): ImageSource | null
  sprite(n: number): ImageSource | null
  printing(printingId: number): Promise<ImageSource | null>
  /** A printing photo's small copy, a JPEG; a 404 when the server has none. Same `key` as `printing`. */
  printingSmall?(printingId: number): Promise<ImageSource | null>
}

const IMAGE_TIMEOUT_MS = 30_000

const PRINTING_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}
const PRINTING_EXTS = ['png', 'jpg', 'webp', 'gif']

/** No downloads under way. */
export const idleDownloads = (): ImageDownloads => ({
  cards: { done: 0, total: 0 },
  sets: { done: 0, total: 0 }
})

/**
 * Passes on download counts at most every `ms` (the latest ones, trailing), so a page queueing
 * hundreds of images doesn't flood the renderer. "None under way" goes out at once.
 */
export function throttleDownloads(
  emit: (d: ImageDownloads) => void,
  ms: number
): (d: ImageDownloads) => void {
  let last = -Infinity
  let latest: ImageDownloads | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    last = Date.now()
    if (latest) emit(latest)
    latest = null
  }
  return (d) => {
    latest = d
    const idle = d.cards.total === 0 && d.sets.total === 0
    if (idle || Date.now() - last >= ms) {
      if (timer) clearTimeout(timer)
      flush()
    } else timer ??= setTimeout(flush, ms - (Date.now() - last))
  }
}

export const defaultLimiter = (): Limiter => createLimiter({ concurrency: 4, minIntervalMs: 100 })
/**
 * Downloads through the portal: most are art it already stores, served from Cloudflare's edge in
 * tens of milliseconds, and the portal paces its own upstream fetches (a per-user hourly quota).
 * So more at once and no gap, or a first visit to a 200-card set waits 20s on the gap alone.
 */
export const portalLimiter = (): Limiter => createLimiter({ concurrency: 8, minIntervalMs: 0 })

export function createImageCache(opts: {
  dir: string
  sources: ImageSources
  fetchFn?: typeof fetch
  now?: () => number
  limit?: Limiter
  /** Rewrites a downloaded Konami logo in place (cutting out its white); a throw drops the download. */
  prepareLogo?: (file: string) => Promise<void>
  /** Hears every change to the downloads under way (cached files never count). */
  onDownloads?: (d: ImageDownloads) => void
}): ImageCache {
  const fetchFn = opts.fetchFn ?? fetch
  const now = opts.now ?? Date.now
  const limit = opts.limit ?? defaultLimiter()
  const inFlight = new Map<string, Promise<string | null>>()
  /**
   * Printing photos the server answered 404 for, by key: not asked again this session (each ask
   * spends image quota). Kept in memory only, so a restart asks again.
   */
  const missingPrintings = new Set<string>()
  /**
   * Downloads since the queue was last empty, by kind: a first visit to a page queues dozens,
   * and their count is what the app shows. Reset once the last one settles.
   */
  let downloads: ImageDownloads = idleDownloads()
  const report = (): void => opts.onDownloads?.(downloads)

  const exists = (p: string): Promise<boolean> =>
    fs.stat(p).then(
      (s) => s.isFile() && s.size > 0,
      () => false
    )

  /** `finalPath` may depend on the response's content-type (printings keep the format they arrive in). */
  async function download(
    source: ImageSource,
    finalPath: string | ((contentType: string) => string | null),
    prepare?: (file: string) => Promise<void>,
    notFound?: () => void
  ): Promise<string | null> {
    const tmpBase =
      typeof finalPath === 'string'
        ? finalPath
        : path.join(opts.dir, 'printings', `dl-${randomUUID()}`)
    const tmpPath = `${tmpBase}.tmp`
    try {
      await fs.mkdir(path.dirname(tmpPath), { recursive: true })
      const res = await fetchFn(source.url, {
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        ...(source.headers && { headers: source.headers })
      })
      if (res.status === 404) notFound?.()
      if (!res.ok || !res.body) return null
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
      if (!contentType.startsWith('image/')) return null
      const target = typeof finalPath === 'string' ? finalPath : finalPath(contentType)
      if (target === null) return null
      if (typeof finalPath !== 'string') await fs.mkdir(path.dirname(target), { recursive: true })
      await pipeline(
        Readable.fromWeb(res.body as unknown as WebReadableStream),
        createWriteStream(tmpPath)
      )
      if ((await fs.stat(tmpPath)).size === 0) throw new Error('empty image body')
      await prepare?.(tmpPath)
      await fs.rename(tmpPath, target)
      return target
    } catch {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined)
      return null
    }
  }

  async function cached(
    key: string,
    source: ImageSource,
    finalPath: string | ((contentType: string) => string | null),
    prepare?: (file: string) => Promise<void>,
    notFound?: () => void,
    priority = false
  ): Promise<string | null> {
    let pending = inFlight.get(key)
    if (!pending) {
      const kind = key.startsWith('set/') ? 'sets' : 'cards'
      downloads = { ...downloads, [kind]: { ...downloads[kind], total: downloads[kind].total + 1 } }
      report()
      pending = limit(() => download(source, finalPath, prepare, notFound), {
        priority,
        key
      }).finally(() => {
        inFlight.delete(key)
        downloads =
          inFlight.size === 0
            ? idleDownloads()
            : { ...downloads, [kind]: { ...downloads[kind], done: downloads[kind].done + 1 } }
        report()
      })
      inFlight.set(key, pending)
    } else if (priority) limit.promote(key)
    return pending
  }

  const fromSource = async (
    source: () => ImageSource | null,
    key: string,
    finalPath: string,
    prepare?: (file: string) => Promise<void>,
    priority = false
  ): Promise<string | null> => {
    if (await exists(finalPath)) return finalPath
    let src: ImageSource | null
    try {
      src = source()
    } catch {
      return null // e.g. the database is closed or busy; never reject the protocol handler
    }
    return src === null ? null : cached(key, src, finalPath, prepare, undefined, priority)
  }

  /** A printing photo already kept on disk under `key`, in whichever format it arrived. */
  const printingOnDisk = async (key: string): Promise<string | null> => {
    const base = path.join(opts.dir, 'printings', key)
    for (const ext of PRINTING_EXTS) if (await exists(`${base}.${ext}`)) return `${base}.${ext}`
    return null
  }

  async function fullPrinting(printingId: number): Promise<string | null> {
    let src: ImageSource | null
    try {
      src = await opts.sources.printing(printingId)
    } catch {
      return null
    }
    if (src === null || !src.key) return null
    const key = src.key
    const onDisk = await printingOnDisk(key)
    if (onDisk) return onDisk
    if (missingPrintings.has(key)) return null
    const base = path.join(opts.dir, 'printings', key)
    return cached(
      `printing/${key}`,
      src,
      (ct) => {
        const ext = PRINTING_EXT[ct.split(';')[0].trim()]
        return ext ? `${base}.${ext}` : null
      },
      undefined,
      () => missingPrintings.add(key)
    )
  }

  return {
    get: (size, id, { priority = false } = {}) =>
      fromSource(
        () => opts.sources.card(size, id),
        `${size}/${id}`,
        path.join(opts.dir, size, `${id}.jpg`),
        undefined,
        priority
      ),

    async getSet(key, { priority = false } = {}) {
      if (!SET_KEY_RE.test(key)) return null
      if (key.startsWith('km-')) {
        if (!opts.prepareLogo) return null // shown only once its white is cut out
        return fromSource(
          () => opts.sources.konami(key),
          `set/${key}`,
          path.join(opts.dir, 'sets', `${key}.png`),
          opts.prepareLogo,
          priority
        )
      }
      return fromSource(
        () => opts.sources.set(key),
        `set/${key}`,
        path.join(opts.dir, 'sets', `${key}.jpg`),
        undefined,
        priority
      )
    },

    async getSprite(n) {
      if (!Number.isInteger(n) || n < 1 || n > POKEDEX_SIZE) return null
      return fromSource(
        () => opts.sources.sprite(n),
        `sprite/${n}`,
        path.join(opts.dir, 'sprites', `${n}.png`)
      )
    },

    async getPrinting(printingId, { small = false } = {}) {
      const full = (): Promise<string | null> => fullPrinting(printingId)
      if (!small || !opts.sources.printingSmall) return full()
      let src: ImageSource | null
      try {
        src = await opts.sources.printingSmall(printingId)
      } catch {
        return full()
      }
      if (src === null || !src.key) return full()
      const key = src.key
      const thumb = path.join(opts.dir, 'printings-small', `${key}.jpg`)
      if (await exists(thumb)) return thumb
      // The server said it had none lately: the full photo until it's asked again.
      const none = `${thumb.slice(0, -4)}.none`
      const said = await fs.stat(none).catch(() => null)
      if (said && now() - said.mtimeMs < SMALL_RETRY_MS) return full()
      const onDisk = await printingOnDisk(key)
      const pending = cached(
        `printing-small/${key}`,
        src,
        (ct) => (ct.split(';')[0].trim() === 'image/jpeg' ? thumb : null),
        undefined,
        () =>
          void fs
            .mkdir(path.dirname(none), { recursive: true })
            .then(() => fs.writeFile(none, ''))
            .catch(() => undefined)
      )
      // A tile with its full photo already kept shows that now; the small copy is for next time.
      if (onDisk) return onDisk
      return (await pending) ?? full()
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
    }
  }
}
