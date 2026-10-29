import {
  imageUrl,
  PACK_ART_PREFIX,
  SET_KEY_RE,
  setImageUrl,
  YUGIPEDIA_IMAGE_PREFIX,
  KONAMI_LOGO_PREFIX,
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

/** A per-key budget for upstream fetches: keyed by user id when signed in, by client address when not. */
export interface ImageQuota<K = number> {
  /** Spends one fetch; false when the key's budget for the current window is gone. */
  take(key: K): boolean
  /** Milliseconds until the key's current window ends; 0 when none is open. */
  retryAfterMs(key: K): number
}

/** Past this many tracked keys, a take first drops every expired window, so a stream of new addresses can't grow the map forever. */
const QUOTA_SWEEP_AT = 10_000

/** In-memory fixed-window quota; a window opens on a key's first take. */
export function createImageQuota<K = number>(
  now: () => number,
  opts: { limit: number; windowMs: number } = { limit: 1000, windowMs: 3_600_000 }
): ImageQuota<K> {
  const windows = new Map<K, { end: number; used: number }>()
  const current = (key: K): { end: number; used: number } | undefined => {
    const w = windows.get(key)
    if (w && w.end > now()) return w
    windows.delete(key)
    return undefined
  }
  return {
    take(key) {
      if (windows.size >= QUOTA_SWEEP_AT) {
        const t = now()
        for (const [k, w] of windows) if (w.end <= t) windows.delete(k)
      }
      const w = current(key) ?? { end: now() + opts.windowMs, used: 0 }
      windows.set(key, w)
      if (w.used >= opts.limit) return false
      w.used += 1
      return true
    },
    retryAfterMs: (key) => Math.max(0, (current(key)?.end ?? 0) - now())
  }
}

/** Upstream card-art fetches one signed-out client address may cause per hour (the iOS app's <img> requests carry no session). */
export const ANON_IMAGE_LIMIT = 300

/** The anonymous card-art quota the Worker uses. */
export const createAnonImageQuota = (now: () => number): ImageQuota<string> =>
  createImageQuota<string>(now, { limit: ANON_IMAGE_LIMIT, windowMs: 3_600_000 })

/**
 * The quota key for a signed-out request: the address Cloudflare reports, with IPv6 cut to
 * its /64 so one host can't rotate through its own prefix. Null when the header is missing.
 */
export function clientAddressKey(req: Request): string | null {
  const ip = req.headers.get('cf-connecting-ip')?.trim().toLowerCase()
  if (!ip) return null
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
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
  /** Spend the quota before `source` runs, because resolving it already calls upstream. */
  meterFirst?: boolean
  /** A fixed YGOPRODeck card image: signed-out requests may fill it too, under the per-address quota. */
  anonymous?: boolean
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
      cache: CARD_CACHE,
      anonymous: true
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
  if (kind === 'konami') {
    if (id.length > MAX_SET_KEY || !SET_KEY_RE.test(id) || !id.startsWith('km-')) return null
    return {
      key: `konami/${id}`,
      cache: SET_CACHE,
      // Served raw; the desktop cuts out the white, so /img/set never shows it.
      source: async () => {
        const url = findSetImageUrl(deps.db, id)
        return url !== null && url.startsWith(KONAMI_LOGO_PREFIX)
          ? { url, headers: { 'User-Agent': USER_AGENT } }
          : null
      }
    }
  }
  if (kind === 'printing') {
    if (!/^\d+$/.test(id)) return null
    const n = Number(id)
    if (!Number.isSafeInteger(n) || n <= 0) return null
    return {
      key: `printing/${n}`,
      cache: SET_CACHE,
      meterFirst: true,
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

/** One requester's slice of a quota. */
interface Meter {
  take(): boolean
  retryAfterMs(): number
}

const metered = <K>(quota: ImageQuota<K> | undefined, key: K): Meter | null =>
  quota ? { take: () => quota.take(key), retryAfterMs: () => quota.retryAfterMs(key) } : null

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

  // Signed-in users may make the portal fetch from upstream; signed-out requests (the iOS app's
  // plain <img> tags) only for known card images, metered per client address. Stored artwork stays public.
  const user = await currentUser(req, deps)
  let meter: Meter | null
  if (user) {
    meter = metered(deps.imageQuota, user.id)
  } else {
    if (!target.anonymous) return notFound()
    const address = clientAddressKey(req)
    if (address === null) return notFound()
    meter = metered(deps.anonImageQuota, address)
  }

  const overQuota = (): Response | null => {
    if (!meter || meter.take()) return null
    const seconds = Math.max(1, Math.ceil(meter.retryAfterMs() / 1000))
    return new Response('Too many requests', { status: 429, headers: { 'retry-after': String(seconds) } })
  }

  const early = target.meterFirst ? overQuota() : null
  if (early) return early
  const source = await target.source()
  if (!source) return notFound()
  // Otherwise the quota is spent only once an upstream fetch is certain.
  const late = target.meterFirst ? null : overQuota()
  if (late) return late

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
