import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createLimiter, type Limiter } from './limiter'

export type ImageSize = 'small' | 'full'

export function imageUrl(size: ImageSize, id: number): string {
  return size === 'full'
    ? `https://images.ygoprodeck.com/images/cards/${id}.jpg`
    : `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`
}

/** Parses `ygo-img://<size>/<id>`; null for unknown sizes or ids that aren't positive integers. */
export function parseImageUrl(url: string): { size: ImageSize; id: number } | null {
  const m = /^ygo-img:\/\/(small|full)\/(\d+)\/?$/.exec(url)
  if (!m) return null
  const id = Number(m[2])
  if (!Number.isSafeInteger(id) || id <= 0) return null
  return { size: m[1] as ImageSize, id }
}

export interface ImageCache {
  get(size: ImageSize, id: number): Promise<string | null>
  sizeBytes(): Promise<number>
  clear(): Promise<void>
}

const IMAGE_TIMEOUT_MS = 30_000

export const defaultLimiter = (): Limiter => createLimiter({ concurrency: 4, minIntervalMs: 100 })

export function createImageCache(opts: { dir: string; fetchFn?: typeof fetch; limit?: Limiter }): ImageCache {
  const fetchFn = opts.fetchFn ?? fetch
  const limit = opts.limit ?? defaultLimiter()
  const inFlight = new Map<string, Promise<string | null>>()

  const exists = (p: string): Promise<boolean> =>
    fs.stat(p).then((s) => s.isFile() && s.size > 0, () => false)

  async function download(size: ImageSize, id: number, finalPath: string): Promise<string | null> {
    const tmpPath = `${finalPath}.tmp`
    try {
      await fs.mkdir(path.dirname(finalPath), { recursive: true })
      const res = await fetchFn(imageUrl(size, id), { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
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

  return {
    async get(size, id) {
      const finalPath = path.join(opts.dir, size, `${id}.jpg`)
      if (await exists(finalPath)) return finalPath
      const key = `${size}/${id}`
      let pending = inFlight.get(key)
      if (!pending) {
        pending = limit(() => download(size, id, finalPath)).finally(() => inFlight.delete(key))
        inFlight.set(key, pending)
      }
      return pending
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
