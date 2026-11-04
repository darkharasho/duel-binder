/**
 * Small copies of the printing photos the portal has stored, for grids (workers/portal/src/thumbs.ts):
 *
 *   npm run catalog:thumbs
 *
 * Env: PORTAL_URL, PORTAL_ADMIN_TOKEN. Lists `printing/` and `printing-small/` in the portal's
 * bucket, then for each photo with no small copy, or one made from an older photo, downloads it,
 * shrinks it to THUMB_WIDTH and stores the JPEG. A photo already that small is stored as it is.
 * Transparent PNGs are left alone (a JPEG would fill their corners), remembered in SKIP_FILE so the
 * next night doesn't download them again; the grid shows their full photo, as before.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { encode as encodeJpeg } from 'jpeg-js'
import type { RgbaImage } from '../../src/shared/scan/types'
import { decodeImage } from './references'

/** The width of small card art (268 × 391), the size the grid tiles are drawn at. */
export const THUMB_WIDTH = 268
const QUALITY = 80
/** The Worker refuses a small copy over this (MAX_THUMB_BYTES). */
const MAX_THUMB_BYTES = 200 * 1024
const CONCURRENCY = 6
/** One night's work stops here; the rest carries over. */
const TIME_BUDGET_MS = 30 * 60 * 1000
const SKIP_FILE = 'catalog-work/thumbs-skip.json'

/** A box-filter shrink to `width` (height to scale); `img` itself when it's no wider. */
export function shrink(img: RgbaImage, width: number): RgbaImage {
  if (img.width <= width) return img
  const height = Math.max(1, Math.round((img.height * width) / img.width))
  const out = new Uint8Array(width * height * 4)
  const sx = img.width / width
  const sy = img.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += img.data[i]
          g += img.data[i + 1]
          b += img.data[i + 2]
          a += img.data[i + 3]
        }
      }
      const n = (x1 - x0) * (y1 - y0)
      const o = (y * width + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return { width, height, data: out }
}

/** True when any pixel is see-through enough to show. */
export function hasTransparency(img: RgbaImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) return true
  return false
}

const isJpeg = (b: Uint8Array): boolean => b[0] === 0xff && b[1] === 0xd8

/** A photo's small copy: a JPEG, the photo itself when it's already small; null to leave it be. */
export function thumbnail(bytes: Uint8Array): Uint8Array | null {
  const img = decodeImage(bytes)
  if (!img || img.width <= 0 || img.height <= 0) return null
  if (img.width <= THUMB_WIDTH && isJpeg(bytes) && bytes.length <= MAX_THUMB_BYTES) return bytes
  if (!isJpeg(bytes) && hasTransparency(img)) return null
  const small = shrink(img, THUMB_WIDTH)
  const out = new Uint8Array(encodeJpeg({ ...small, data: Buffer.from(small.data) }, QUALITY).data)
  return out.length <= MAX_THUMB_BYTES ? out : null
}

export interface Stored {
  key: string
  from?: string
}

/**
 * The photos to make a small copy of: each `printing/<id><suffix>` whose `printing-small/<id>` is
 * missing or was made from another key, less the ones `skip` lists.
 */
export function todo(photos: Stored[], thumbs: Stored[], skip: ReadonlySet<string>): string[] {
  const made = new Map(thumbs.map((t) => [t.key.slice('printing-small/'.length), t.from]))
  return photos
    .map((p) => p.key)
    .filter((key) => {
      const id = /^printing\/(\d+)/.exec(key)?.[1]
      return id !== undefined && made.get(id) !== key && !skip.has(key)
    })
}

interface Portal {
  url: string
  token: string
  fetch: typeof fetch
}

async function call(p: Portal, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await p.fetch(`${p.url.replace(/\/+$/, '')}/api/admin/thumbs/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${p.token}`, ...(init.headers ?? {}) }
  })
  return res
}

async function listAll(p: Portal, prefix: string): Promise<Stored[]> {
  const out: Stored[] = []
  let cursor: string | null = ''
  while (cursor !== null) {
    const res = await call(p, `list?${new URLSearchParams({ prefix, cursor })}`)
    if (!res.ok) throw new Error(`Listing ${prefix} failed: HTTP ${res.status}`)
    const page = (await res.json()) as { objects: Stored[]; cursor: string | null }
    out.push(...page.objects)
    cursor = page.cursor
  }
  return out
}

export async function runThumbs(
  p: Portal,
  opts: { skip: Set<string>; now?: () => number; budgetMs?: number } = { skip: new Set() }
): Promise<{ made: number; skipped: number; failed: number; left: number }> {
  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? TIME_BUDGET_MS)
  const [photos, thumbs] = await Promise.all([
    listAll(p, 'printing/'),
    listAll(p, 'printing-small/')
  ])
  const queue = todo(photos, thumbs, opts.skip)
  const total = queue.length
  let made = 0
  let skipped = 0
  let failed = 0
  const worker = async (): Promise<void> => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      if (now() > deadline) {
        queue.unshift(key)
        return
      }
      try {
        const res = await call(p, `photo?${new URLSearchParams({ key })}`)
        if (!res.ok) {
          await res.body?.cancel()
          failed++
          continue
        }
        const small = thumbnail(new Uint8Array(await res.arrayBuffer()))
        if (!small) {
          opts.skip.add(key)
          skipped++
          continue
        }
        const id = /^printing\/(\d+)/.exec(key)![1]
        const put = await call(p, id, {
          method: 'PUT',
          body: small as Uint8Array<ArrayBuffer>,
          headers: { 'content-type': 'image/jpeg', 'x-thumb-from': key }
        })
        await put.body?.cancel()
        if (put.ok) made++
        else failed++
      } catch (e) {
        failed++
        console.warn('Small copy failed:', key, e instanceof Error ? e.message : String(e))
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(
    `Printing photos: ${photos.length} stored, ${total} needed a small copy; made ${made}, left ${skipped} as they are, ${failed} failed, ${queue.length} for next time.`
  )
  return { made, skipped, failed, left: queue.length }
}

async function main(): Promise<void> {
  const url = process.env['PORTAL_URL']
  const token = process.env['PORTAL_ADMIN_TOKEN']
  if (!url || !token) throw new Error('PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set')
  const skip = new Set<string>(
    existsSync(SKIP_FILE) ? (JSON.parse(readFileSync(SKIP_FILE, 'utf8')) as string[]) : []
  )
  const r = await runThumbs({ url, token, fetch }, { skip })
  writeFileSync(SKIP_FILE, JSON.stringify([...skip]))
  // Some failures are expected (a photo deleted mid-run); most failing means the portal is down.
  if (r.failed > 0 && r.failed >= r.made) process.exitCode = 1
}

if (process.argv[1]?.endsWith('thumbs.mjs')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
