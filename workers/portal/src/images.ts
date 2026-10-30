import {
  imageUrl,
  PACK_ART_PREFIX,
  SET_KEY_RE,
  setImageUrl,
  YUGIPEDIA_IMAGE_PREFIX,
  KONAMI_LOGO_PREFIX,
  BULBAGARDEN_IMAGE_PREFIX,
  isFallbackLogoUrl,
  type ImageSize
} from '../../../src/shared/imageSources'
import { PKM_ID_MIN } from '../../../src/shared/games/ids'
import { findPokemonSetArtUrl, findSetImageUrl } from '../../../src/main/repo/sets'
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
  /** True when the key's budget for the current window is gone; spends nothing and opens no window. */
  exhausted(key: K): boolean
}

export interface QuotaOptions {
  limit: number
  windowMs: number
  /**
   * Hard cap on tracked keys. When set, expired windows are swept at most once a minute and a
   * new key past the cap evicts the oldest-opened one. Unset (the signed-in quota) never evicts.
   */
  maxKeys?: number
}

const QUOTA_SWEEP_EVERY_MS = 60_000

/** In-memory fixed-window quota; a window opens on a key's first take. */
export function createImageQuota<K = number>(
  now: () => number,
  opts: QuotaOptions = { limit: 1000, windowMs: 3_600_000 }
): ImageQuota<K> {
  const windows = new Map<K, { end: number; used: number }>()
  let lastSweep = -Infinity
  const current = (key: K): { end: number; used: number } | undefined => {
    const w = windows.get(key)
    if (w && w.end > now()) return w
    windows.delete(key)
    return undefined
  }
  const open = (key: K): { end: number; used: number } => {
    const t = now()
    if (opts.maxKeys !== undefined) {
      if (t - lastSweep >= QUOTA_SWEEP_EVERY_MS) {
        lastSweep = t
        for (const [k, w] of windows) if (w.end <= t) windows.delete(k)
      }
      // Map order is insertion order, and a key is only re-inserted once its window has expired.
      while (windows.size >= opts.maxKeys) windows.delete(windows.keys().next().value as K)
    }
    const w = { end: t + opts.windowMs, used: 0 }
    windows.set(key, w)
    return w
  }
  return {
    take(key) {
      const w = current(key) ?? open(key)
      if (w.used >= opts.limit) return false
      w.used += 1
      return true
    },
    retryAfterMs: (key) => Math.max(0, (current(key)?.end ?? 0) - now()),
    exhausted: (key) => (current(key)?.used ?? 0) >= opts.limit
  }
}

/** Upstream card-art fetches one signed-out client address may cause per hour (the iOS app's <img> requests carry no session). */
export const ANON_IMAGE_LIMIT = 300
/** Upstream card-art fetches all signed-out clients together may cause per hour. */
export const ANON_IMAGE_GLOBAL_LIMIT = 5000
/** Client addresses the signed-out quota tracks at once; the oldest window is dropped past this. */
export const ANON_IMAGE_MAX_KEYS = 20_000

const GLOBAL = '*'

/**
 * The signed-out card-art quota: a per-address budget under one shared hourly ceiling. A fetch
 * spends from both only when neither is gone, so a full ceiling opens no per-address windows.
 */
export function createAnonImageQuota(
  now: () => number,
  opts: { perAddress?: number; global?: number; maxKeys?: number } = {}
): ImageQuota<string> {
  const windowMs = 3_600_000
  const perAddress = createImageQuota<string>(now, {
    limit: opts.perAddress ?? ANON_IMAGE_LIMIT,
    windowMs,
    maxKeys: opts.maxKeys ?? ANON_IMAGE_MAX_KEYS
  })
  const global = createImageQuota<string>(now, {
    limit: opts.global ?? ANON_IMAGE_GLOBAL_LIMIT,
    windowMs
  })
  const exhausted = (key: string): boolean => perAddress.exhausted(key) || global.exhausted(GLOBAL)
  return {
    take(key) {
      if (exhausted(key)) return false
      perAddress.take(key)
      global.take(GLOBAL)
      return true
    },
    // The later of the two limits that is in force.
    retryAfterMs: (key) =>
      Math.max(
        perAddress.exhausted(key) ? perAddress.retryAfterMs(key) : 0,
        global.exhausted(GLOBAL) ? global.retryAfterMs(GLOBAL) : 0
      ),
    exhausted
  }
}

/** R2 keys whose upstream fetch recently failed, so signed-out requests don't refetch them every time. */
export interface MissCache {
  has(key: string): boolean
  add(key: string): void
}

export const ANON_MISS_TTL_MS = 3_600_000
export const ANON_MISS_MAX_KEYS = 10_000

/** Bounded in-memory miss list; past `maxKeys` the oldest entry is dropped. */
export function createMissCache(
  now: () => number,
  opts: { ttlMs: number; maxKeys: number } = {
    ttlMs: ANON_MISS_TTL_MS,
    maxKeys: ANON_MISS_MAX_KEYS
  }
): MissCache {
  const until = new Map<string, number>()
  return {
    has(key) {
      const end = until.get(key)
      if (end === undefined) return false
      if (end > now()) return true
      until.delete(key)
      return false
    },
    add(key) {
      until.delete(key) // re-insert at the back, so the order stays oldest first
      while (until.size >= opts.maxKeys) until.delete(until.keys().next().value as string)
      until.set(key, now() + opts.ttlMs)
    }
  }
}

/**
 * The quota key for a signed-out request: the address Cloudflare reports, IPv4-mapped IPv6
 * unwrapped, and other IPv6 cut to its /56 so one site can't rotate through its own prefix.
 * Null when the header is missing.
 */
export function clientAddressKey(req: Request): string | null {
  const ip = req.headers.get('cf-connecting-ip')?.trim().toLowerCase()
  if (!ip) return null
  if (!ip.includes(':')) return ip
  const mapped = /^(?:0{0,4}:){1,6}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (mapped) return mapped[1]
  const [head, tail = ''] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left
  const g = groups.slice(0, 4).map((x) => parseInt(x || '0', 16) || 0)
  g[3] &= 0xff00
  return `${g.map((x) => x.toString(16)).join(':')}::/56`
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

const TCGDEX_PREFIX = 'https://assets.tcgdex.net/'
const TCGPLAYER_CDN_PREFIX = 'https://tcgplayer-cdn.tcgplayer.com/'

/** The upstream URL of a Pokémon card image at `size`; null for a foreign host. */
function pokemonArtUrl(base: string, size: 'small' | 'full'): string | null {
  if (base.startsWith(TCGDEX_PREFIX)) return `${base}/${size === 'small' ? 'low' : 'high'}.webp`
  if (base.startsWith(TCGPLAYER_CDN_PREFIX)) {
    return base.replace(/_200w\.jpg$/, size === 'small' ? '_200w.jpg' : '_in_1000x1000.jpg')
  }
  return null
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
    if (n >= PKM_ID_MIN) {
      const row = deps.db
        .prepare(
          'SELECT pc.image_url FROM card_images ci JOIN pokemon_cards pc ON pc.card_id = ci.card_id WHERE ci.image_id = ?'
        )
        .get(n) as { image_url: string | null } | undefined
      // TCGdex and TCGplayer have no crop, so a Pokémon `cropped` (a set tile's backdrop) is the small art.
      const url = row?.image_url
        ? pokemonArtUrl(row.image_url, kind === 'full' ? 'full' : 'small')
        : null
      if (url === null) return null
      return { key: `card/${kind}/${n}`, source: fixed(url), cache: CARD_CACHE, anonymous: true }
    }
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
    if (prefix === 'td-') {
      const row = deps.db
        .prepare("SELECT image_url FROM sets WHERE image_key = ? AND +game = 'pkm'")
        .get(id) as { image_url: string | null } | undefined
      if (!row?.image_url || !row.image_url.startsWith(TCGDEX_PREFIX)) return null
      return { key: `set/${id}`, source: fixed(`${row.image_url}.webp`), cache: SET_CACHE }
    }
    if (prefix === 'bp-' || prefix === 'pt-') {
      // Pokémon pack art (Bulbagarden Archives) and fallback logos (Pokémon TCG API).
      const source = findPokemonSetArtUrl(deps.db, id)
      if (source === null) return null
      const allowed =
        prefix === 'bp-' ? source.startsWith(BULBAGARDEN_IMAGE_PREFIX) : isFallbackLogoUrl(source)
      if (!allowed) return null
      return {
        key: `set/${id}`,
        source: fixed(source, { 'User-Agent': USER_AGENT }),
        cache: SET_CACHE
      }
    }
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
    if (deps.anonMisses?.has(target.key)) return notFound()
    meter = metered(deps.anonImageQuota, address)
  }

  const overQuota = (): Response | null => {
    if (!meter || meter.take()) return null
    const seconds = Math.max(1, Math.ceil(meter.retryAfterMs() / 1000))
    return new Response('Too many requests', {
      status: 429,
      headers: { 'retry-after': String(seconds) }
    })
  }

  const early = target.meterFirst ? overQuota() : null
  if (early) return early
  const source = await target.source()
  if (!source) return notFound()
  // Otherwise the quota is spent only once an upstream fetch is certain.
  const late = target.meterFirst ? null : overQuota()
  if (late) return late

  const got = await fetchAndStore(deps, target, source)
  if (!got) {
    // A failed fetch of signed-out-servable art is remembered, so signed-out callers stop refetching it.
    if (target.anonymous) deps.anonMisses?.add(target.key)
    return notFound()
  }
  return reply(got.bytes, got.contentType)
}

/** Fetches a target's artwork from upstream and stores it in R2; null when upstream has no usable image. */
async function fetchAndStore(
  deps: AppDeps,
  target: Target,
  source: { url: string; headers?: Record<string, string> }
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  let bytes: ArrayBuffer
  let contentType: string
  try {
    const res = await deps.fetch(source.url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      redirect: 'manual', // the prefix check covers only the first hop
      ...(source.headers && { headers: source.headers })
    })
    contentType = mediaType(res.headers.get('content-type') ?? '')
    if (!res.ok || !IMAGE_TYPES.has(contentType)) return null
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return null
    bytes = await res.arrayBuffer()
  } catch {
    return null
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null
  await deps.images.put(target.key, bytes, { httpMetadata: { contentType } }).catch(() => undefined) // still serve what was fetched
  return { bytes, contentType }
}

export type WarmResult = 'stored' | 'cached' | 'missing' | 'failed'

/**
 * Admin only (the nightly job): makes sure one set image is in R2, fetching it from upstream if
 * it isn't. The job calls this one image at a time, paced, so a source like the Bulbagarden
 * Archives sees each new image fetched once, slowly, instead of in bursts from clients' first views.
 */
export async function warmImage(deps: AppDeps, path: string): Promise<WarmResult> {
  if (!path.startsWith('set/')) return 'missing'
  const target = resolve(deps, path)
  if (!target) return 'missing'
  const stored = await deps.images.get(target.key).catch(() => null)
  if (stored) {
    try {
      await stored.body.cancel() // only its presence matters
    } catch {
      // already read or closed
    }
    return 'cached'
  }
  const source = await target.source()
  if (!source) return 'missing'
  return (await fetchAndStore(deps, target, source)) ? 'stored' : 'failed'
}
