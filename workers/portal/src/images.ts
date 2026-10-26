import {
  imageUrl,
  PACK_ART_PREFIX,
  SET_KEY_RE,
  setImageUrl,
  YUGIPEDIA_IMAGE_PREFIX,
  type ImageSize
} from '../../../src/shared/imageSources'
import { findSetImageUrl } from '../../../src/main/repo/sets'
import { TCGPLAYER_IMAGE_PREFIX } from '../../../src/main/tcgplayer/catalog'
import type { AppDeps } from './app'
import { currentUser } from './auth'

/** The slice of an R2 bucket the image route uses. */
export interface ImageBucket {
  get(key: string): Promise<{
    body: ReadableStream
    httpMetadata?: { contentType?: string }
    /** The quoted ETag R2 assigns each stored object. */
    httpEtag?: string
  } | null>
  put(
    key: string,
    value: ArrayBuffer,
    opts: { httpMetadata: { contentType: string } }
  ): Promise<unknown>
}

const IMAGE_TIMEOUT_MS = 30_000
const USER_AGENT = 'DuelBinder/portal (https://github.com/darkharasho/duel-binder)'
const CARD_CACHE = 'public, max-age=31536000, immutable'
const SET_CACHE = 'public, max-age=86400'

const MAX_SET_KEY = 200
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** Formats safe to serve from the app origin; notably not SVG, which can carry script. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/** The media type alone, lowercased and without parameters. */
const mediaType = (contentType: string): string => contentType.split(';')[0].trim().toLowerCase()

/** The promise's value, or null if it hasn't settled within `ms`; the timer never outlives the race. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const notFound = (): Response => new Response('Not found', { status: 404 })

/** Defence in depth: whatever the body is, the browser must not run or sniff it. */
function locked(res: Response): Response {
  res.headers.set('x-content-type-options', 'nosniff')
  res.headers.set('content-security-policy', 'sandbox')
  return res
}

interface Target {
  key: string
  /** The upstream URL and any request headers it needs, looked up only on an R2 miss; null when there is none. */
  source: () => Promise<{ url: string; headers?: Record<string, string> } | null>
  cache: string
}

const fixed =
  (url: string, headers?: Record<string, string>): Target['source'] =>
  async () => ({ url, headers })

/** Where a request's artwork comes from and how long browsers may keep it; null when the path names nothing servable. */
function resolve(deps: AppDeps, path: string): Target | null {
  const [kind, id, ...rest] = path.split('/')
  if (id === undefined || rest.length > 0) return null
  if (kind === 'small' || kind === 'full' || kind === 'cropped') {
    if (!/^\d+$/.test(id)) return null
    const n = Number(id)
    if (!Number.isSafeInteger(n) || n <= 0) return null
    if (!deps.db.prepare('SELECT 1 FROM card_images WHERE image_id = ?').get(n)) return null
    return {
      key: `card/${kind satisfies ImageSize}/${n}`,
      source: fixed(imageUrl(kind, n)),
      cache: CARD_CACHE
    }
  }
  if (kind === 'set') {
    if (id.length > MAX_SET_KEY || !SET_KEY_RE.test(id)) return null
    const prefix = id.slice(0, 3)
    if (prefix === 'km-') return null
    if (prefix === 'yp-' || prefix === 'yc-') {
      const source = findSetImageUrl(deps.db, id)
      const allowed = prefix === 'yp-' ? YUGIPEDIA_IMAGE_PREFIX : PACK_ART_PREFIX
      if (source === null || !source.startsWith(allowed)) return null
      return {
        key: `set/${id}`,
        source: fixed(source, { 'User-Agent': USER_AGENT }),
        cache: SET_CACHE
      }
    }
    return { key: `set/${id}`, source: fixed(setImageUrl(id)), cache: SET_CACHE }
  }
  if (kind === 'printing') {
    if (!/^\d+$/.test(id)) return null
    const n = Number(id)
    if (!Number.isSafeInteger(n) || n <= 0) return null
    return {
      key: `printing/${n}`,
      cache: SET_CACHE,
      source: async () => {
        const url = await withTimeout(
          deps.printingArt.url(n).catch(() => null),
          IMAGE_TIMEOUT_MS
        )
        if (url === null) return null
        if (url.startsWith(YUGIPEDIA_IMAGE_PREFIX))
          return { url, headers: { 'User-Agent': USER_AGENT } }
        return url.startsWith(TCGPLAYER_IMAGE_PREFIX) ? { url } : null
      }
    }
  }
  return null
}

/** GET/HEAD /img/<path>: artwork mirrored into R2 on first request, so the web build never hotlinks its sources. */
export async function imageRoute(req: Request, deps: AppDeps, path: string): Promise<Response> {
  return locked(await serve(req, deps, path))
}

async function serve(req: Request, deps: AppDeps, path: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const target = resolve(deps, path)
  if (!target) return notFound()

  const reply = (body: BodyInit | null, contentType: string): Response =>
    new Response(req.method === 'HEAD' ? null : body, {
      headers: { 'content-type': contentType, 'cache-control': target.cache }
    })

  const stored = await deps.images.get(target.key).catch(() => null) // a failing bucket is a miss
  if (stored) return reply(stored.body, stored.httpMetadata?.contentType ?? 'image/jpeg')

  // Only signed-in users may make the portal fetch from upstream; stored artwork stays public.
  if (!(await currentUser(req, deps))) return notFound()

  const source = await target.source()
  if (!source) return notFound()

  let bytes: ArrayBuffer
  let contentType: string
  try {
    const res = await deps.fetch(source.url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      redirect: 'manual', // the prefix check covers only the first hop
      ...(source.headers && { headers: source.headers })
    })
    contentType = mediaType(res.headers.get('content-type') ?? '')
    if (!res.ok || !IMAGE_TYPES.has(contentType)) return notFound()
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return notFound()
    bytes = await res.arrayBuffer()
  } catch {
    return notFound()
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return notFound()
  await deps.images.put(target.key, bytes, { httpMetadata: { contentType } }).catch(() => undefined) // still serve what was fetched
  return reply(bytes, contentType)
}
