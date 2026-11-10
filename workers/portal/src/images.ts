import {
  isOpPackUrl,
  opBandaiArtUrl,
  opTcgArtUrl,
  scryfallArtUrl,
  imageUrl,
  PACK_ART_PREFIX,
  SET_KEY_RE,
  setImageUrl,
  YUGIPEDIA_IMAGE_PREFIX,
  yugipediaFetchUrl,
  KONAMI_LOGO_PREFIX,
  BULBAGARDEN_IMAGE_PREFIX,
  HAND_ART_PREFIX,
  TCGPLAYER_PACK_PREFIX,
  isFallbackLogoUrl,
  MAX_SYMBOL_PNG_BYTES,
  MTG_SYMBOL_KEY_PREFIX,
  type ImageSize
} from '../../../src/shared/imageSources'
import { gameOfId, isTokenId, mtgBackImageId, mtgImageId } from '../../../src/shared/games/ids'
import { POKEDEX_SIZE } from '../../../src/shared/pokedex'
import { uprightJpeg } from '../../../src/shared/upright'
import { findPokemonSetArtUrl, findSetImageUrl } from '../../../src/main/repo/sets'
import { TCGPLAYER_IMAGE_PREFIX } from '../../../src/main/tcgplayer/catalog'
import { printingPhotoSuffix } from '../../../src/main/yugipedia/printingArt'
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

/**
 * R2 keys whose upstream fetch recently failed, so signed-out requests don't refetch them every
 * time; and, under oversizedKey, those upstream had only as an image too big to keep, which no
 * request of anyone's refetches.
 */
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

/** The miss cache's entry for an R2 key whose upstream image is over MAX_IMAGE_BYTES. */
const oversizedKey = (key: string): string => `oversized:${key}`

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
  /** Stand a sideways JPEG upright before keeping it: TCGplayer photographs a LEGEND half sideways. */
  upright?: boolean
}

const TCGDEX_PREFIX = 'https://assets.tcgdex.net/'
const HAND_PATH_RE = /^[a-z0-9-]+\/[a-z]+\.(?:jpg|png)$/
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

/** Art that is only ever in R2, at the path after /img/ of its HAND_ART_PREFIX URL. */
const handArt = (url: string, cache: string): Target => ({
  key: url.slice(HAND_ART_PREFIX.length - 'hand/'.length),
  source: async () => null,
  cache
})

/**
 * The R2 key card art at `size` is stored under, from the id alone (no catalog lookup). Pokémon
 * art only ever in R2 (HAND_ART_PREFIX) lives elsewhere; for those this key is simply never stored.
 */
const cardArtKey = (size: ImageSize, n: number): string =>
  isTokenId(n)
    ? `card/full/${n}`
    : gameOfId(n) === 'op' || gameOfId(n) === 'mtg'
      ? `card/${size === 'full' ? 'full' : 'small'}/${n}`
      : `card/${size}/${n}`

/** A Pokédex sprite by national number, kept in R2 as sprite/<n>.png. */
const SPRITE_PATH_RE = /^\/img\/sprite\/([1-9]\d{0,3})$/

const CARD_PATH_RE = /^\/img\/(small|full|cropped)\/(\d+)$/
/** A printing photo's small copy, by the server's printing id (see thumbs.ts). */
const THUMB_PATH_RE = /^\/img\/printing-small\/([1-9]\d{0,15})$/
/** How long the edge keeps a full photo served for a small copy not yet made. */
const FALLBACK_CACHE = 'public, max-age=3600'

/** The slice of Cloudflare's per-colo cache (caches.default) the edge image path uses. */
export interface EdgeCache {
  match(req: Request): Promise<Response | undefined>
  put(req: Request, res: Response): Promise<void>
}

/** A copy fit for the shared cache: no per-origin CORS headers, which the caller adds back. */
function cacheable(res: Response): Response {
  const out = new Response(res.body, res)
  for (const h of [...out.headers.keys()])
    if (h.startsWith('access-control-') || h === 'vary') out.headers.delete(h)
  return out
}

/**
 * The stateless Worker's way to artwork, ahead of the Durable Object (one instance for everyone,
 * busy with sync and prices): from the edge cache; else stored card art straight from R2; else
 * `forward` (the Durable Object, which resolves and fetches as before), keeping a 200 at the edge.
 * Null for anything that isn't a GET of /img/. A 200 is stored artwork, public whoever asked, and
 * its cache-control (a year for card art, a day for sets and printing photos) bounds how long the
 * edge keeps it, as it already does for browsers.
 */
export async function edgeImage(
  req: Request,
  bucket: Pick<ImageBucket, 'get'>,
  edge: EdgeCache | null,
  waitUntil: (p: Promise<unknown>) => void,
  forward: (req: Request) => Promise<Response>
): Promise<Response | null> {
  const url = new URL(req.url)
  if (req.method !== 'GET' || !url.pathname.startsWith('/img/')) return null
  // The cache key drops headers (a desktop's Authorization) so every client shares one entry.
  const cacheKey = new Request(url.toString(), { method: 'GET' })
  const hit = await edge?.match(cacheKey).catch(() => undefined)
  if (hit) return hit
  const keep = (res: Response): Response => {
    if (edge && res.status === 200 && /\bpublic\b/.test(res.headers.get('cache-control') ?? ''))
      waitUntil(edge.put(cacheKey, cacheable(res.clone())).catch(() => undefined))
    return res
  }
  const m = CARD_PATH_RE.exec(url.pathname)
  const n = m ? Number(m[2]) : NaN
  if (m && Number.isSafeInteger(n) && n > 0) {
    const stored = await bucket.get(cardArtKey(m[1] as ImageSize, n)).catch(() => null)
    if (stored)
      return keep(
        locked(
          new Response(stored.body, {
            headers: {
              'content-type': stored.httpMetadata?.contentType ?? 'image/jpeg',
              'cache-control': CARD_CACHE
            }
          })
        )
      )
  }
  const sprite = SPRITE_PATH_RE.exec(url.pathname)
  if (sprite && Number(sprite[1]) <= POKEDEX_SIZE) {
    const stored = await bucket.get(`sprite/${sprite[1]}.png`).catch(() => null)
    if (stored)
      return keep(
        locked(
          new Response(stored.body, {
            headers: {
              'content-type': stored.httpMetadata?.contentType ?? 'image/png',
              'cache-control': CARD_CACHE
            }
          })
        )
      )
  }
  const small = THUMB_PATH_RE.exec(url.pathname)
  if (small) {
    const thumb = await bucket.get(`printing-small/${small[1]}`).catch(() => null)
    if (thumb)
      return keep(
        locked(
          new Response(thumb.body, {
            headers: {
              'content-type': thumb.httpMetadata?.contentType ?? 'image/jpeg',
              'cache-control': SET_CACHE
            }
          })
        )
      )
    // `?only` (the desktop): no small copy is a 404, so it shows the full photo it keeps on disk
    // rather than download that again in the small copy's place.
    if (url.searchParams.has('only'))
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
    // No small copy yet: the full photo, kept at the edge only an hour, so the small copy the
    // next nightly job makes takes its place soon after.
    const full = new URL(url)
    full.pathname = `/img/printing/${small[1]}`
    const res = await forward(new Request(full.toString(), req))
    if (res.status !== 200) return res
    const out = new Response(res.body, res)
    out.headers.set('cache-control', FALLBACK_CACHE)
    return keep(out)
  }
  return keep(await forward(req))
}

/** Where a request's artwork comes from and how long browsers may keep it; null when the path names nothing servable. */
function resolve(deps: AppDeps, path: string): Target | null {
  const [kind, id, ...rest] = path.split('/')
  if (kind === 'hand') {
    if (id === undefined || rest.length !== 1 || !HAND_PATH_RE.test(`${id}/${rest[0]}`)) return null
    return handArt(`${HAND_ART_PREFIX}${id}/${rest[0]}`, CARD_CACHE)
  }
  if (id === undefined || rest.length > 0) return null
  if (kind === 'sprite') {
    // R2 only (uploaded by hand); anonymous so the phone's unsigned requests are served.
    if (!/^[1-9]\d{0,3}$/.test(id) || Number(id) > POKEDEX_SIZE) return null
    return { key: `sprite/${id}.png`, source: async () => null, cache: CARD_CACHE, anonymous: true }
  }
  if (kind === 'small' || kind === 'full' || kind === 'cropped') {
    if (!/^\d+$/.test(id)) return null
    const n = Number(id)
    if (!Number.isSafeInteger(n) || n <= 0) return null
    const game = gameOfId(n)
    if (game === 'op') {
      const row = deps.db
        .prepare('SELECT bandai_id FROM onepiece_images WHERE image_id = ?')
        .get(n) as { bandai_id: string } | undefined
      // A DON!! card's art is TCGplayer's, in two sizes as Pokémon's is.
      const tcg = row ? opTcgArtUrl(row.bandai_id, kind === 'full' ? 'full' : 'small') : null
      if (tcg !== null)
        return { key: cardArtKey(kind, n), source: fixed(tcg), cache: CARD_CACHE, anonymous: true }
      // English art is a bare Bandai id, Japanese `ja:<id>`.
      const bandai = row ? opBandaiArtUrl(row.bandai_id) : null
      if (bandai === null) return null
      // The PNG is always stored under card/full; the job's small copy takes card/small later.
      return {
        key: `card/full/${n}`,
        source: fixed(bandai, {
          'User-Agent': USER_AGENT
        }),
        cache: kind === 'full' ? CARD_CACHE : FALLBACK_CACHE,
        anonymous: true
      }
    }
    if (game === 'mtg') {
      // Magic art is shown whole (never cropped), so `cropped` is the small copy as in cardArtKey.
      type ArtRow = { scryfall_id: string; art_from: string | null }
      const front = deps.db
        .prepare('SELECT scryfall_id, art_from FROM mtg_images WHERE image_id = ?')
        .get(n) as ArtRow | undefined
      // A back face has no row of its own: it is found through its front's back_image_id.
      const row =
        front ??
        (deps.db
          .prepare('SELECT scryfall_id, art_from FROM mtg_images WHERE back_image_id = ?')
          .get(n) as ArtRow | undefined)
      const url =
        row && row.art_from !== 'none'
          ? scryfallArtUrl(
              row.art_from ?? row.scryfall_id,
              kind === 'full' ? 'full' : 'small',
              front ? 'front' : 'back'
            )
          : null
      if (url === null) return null
      // Borrowed English art is a placeholder until Scryfall has this object's own scan: keep it
      // under the lender's key (one copy shared with the English printing, and this object's own
      // key stays free for the real scan) and let browsers and the edge keep it only briefly.
      const lender = row?.art_from ?? null
      if (lender !== null)
        return {
          key: cardArtKey(kind, front ? mtgImageId(lender) : mtgBackImageId(lender)),
          source: fixed(url, { 'User-Agent': USER_AGENT }),
          cache: FALLBACK_CACHE,
          anonymous: true
        }
      return {
        key: cardArtKey(kind, n),
        source: fixed(url, { 'User-Agent': USER_AGENT }),
        cache: CARD_CACHE,
        anonymous: true
      }
    }
    if (game === 'pkm') {
      const row = deps.db
        .prepare(
          'SELECT pc.image_url, c.name FROM card_images ci JOIN pokemon_cards pc ON pc.card_id = ci.card_id JOIN cards c ON c.id = ci.card_id WHERE ci.image_id = ?'
        )
        .get(n) as { image_url: string | null; name: string } | undefined
      if (row?.image_url?.startsWith(HAND_ART_PREFIX))
        return handArt(`${row.image_url}/${kind === 'full' ? 'high' : 'low'}.jpg`, CARD_CACHE)
      // TCGdex and TCGplayer have no crop, so a Pokémon `cropped` (a set tile's backdrop) is the small art.
      const url = row?.image_url
        ? pokemonArtUrl(row.image_url, kind === 'full' ? 'full' : 'small')
        : null
      if (url === null) return null
      return {
        key: cardArtKey(kind, n),
        source: fixed(url),
        cache: CARD_CACHE,
        anonymous: true,
        // Only a LEGEND half: a BREAK card is landscape as it stands, and TCGplayer shows it so.
        upright: url.startsWith(TCGPLAYER_CDN_PREFIX) && /\bLEGEND\b/i.test(row!.name)
      }
    }
    if (!deps.db.prepare('SELECT 1 FROM card_images WHERE image_id = ?').get(n)) return null
    if (isTokenId(n)) {
      // The id names its Yugipedia file. There is one size of it, the original (Yugipedia makes no
      // crops, nor thumbnails for others), so every size is one stored image and one fetch.
      return {
        key: cardArtKey(kind, n),
        cache: CARD_CACHE,
        anonymous: true,
        meterFirst: true,
        source: async () => {
          const art = deps.tokenArt?.(n).catch(() => null)
          const url = art ? await withTimeout(art, IMAGE_TIMEOUT_MS) : null
          return url?.startsWith(YUGIPEDIA_IMAGE_PREFIX)
            ? { url, headers: { 'User-Agent': USER_AGENT } }
            : null
        }
      }
    }
    return {
      key: cardArtKey(kind satisfies ImageSize, n),
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
    if (prefix === 'bp-' || prefix === 'tp-' || prefix === 'pt-') {
      // Pokémon pack art (Bulbagarden Archives, else TCGplayer) and fallback logos (Pokémon TCG API).
      const source = findPokemonSetArtUrl(deps.db, id)
      if (source === null) return null
      const allowed =
        prefix === 'bp-'
          ? source.startsWith(BULBAGARDEN_IMAGE_PREFIX)
          : prefix === 'tp-'
            ? source.startsWith(TCGPLAYER_PACK_PREFIX)
            : isFallbackLogoUrl(source)
      if (!allowed) return null
      if (source.startsWith(HAND_ART_PREFIX)) return handArt(source, SET_CACHE)
      return {
        key: `set/${id}`,
        source: fixed(source, { 'User-Agent': USER_AGENT }),
        cache: SET_CACHE
      }
    }
    if (prefix === 'ob-') {
      // A One Piece set's pack shot from Bandai's product listing.
      const row = deps.db
        .prepare("SELECT image_url FROM sets WHERE image_key = ? AND +game = 'op'")
        .get(id) as { image_url: string | null } | undefined
      if (!row?.image_url || !isOpPackUrl(row.image_url)) return null
      return {
        key: `set/${id}`,
        source: fixed(row.image_url, { 'User-Agent': USER_AGENT }),
        cache: SET_CACHE
      }
    }
    if (prefix === MTG_SYMBOL_KEY_PREFIX) {
      // A Magic set symbol: a PNG the catalog job made from Scryfall's SVG (storeSetSymbol). R2 only,
      // never fetched from upstream, so the SVG itself never passes through here.
      return { key: `set/${id}`, source: async () => null, cache: SET_CACHE }
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
    const printing = deps.db
      .prepare('SELECT set_rarity AS rarity, variant, game FROM card_printings WHERE id = ?')
      .get(n) as { rarity: string; variant: string | null; game: string } | undefined
    return {
      key: `printing/${n}${printing ? printingPhotoSuffix(printing) : ''}`,
      cache: SET_CACHE,
      // The phone's <img> tags carry no session. A printing the catalog has may be looked up
      // signed out too, metered per address before the lookup, as card art is.
      anonymous: printing !== undefined,
      meterFirst: true,
      source: async () => {
        // One Piece and Magic have no printing photos to look up.
        if (printing?.game === 'op' || printing?.game === 'mtg') return null
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

  // An image too big to keep stays so however many ask: no quota, Yugipedia call or fetch for it.
  if (deps.anonMisses?.has(oversizedKey(target.key))) return notFound()

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
  if (got === 'oversized') deps.anonMisses?.add(oversizedKey(target.key))
  if (!got || got === 'oversized') {
    // A failed fetch of signed-out-servable art is remembered, so signed-out callers stop refetching it.
    if (target.anonymous) deps.anonMisses?.add(target.key)
    return notFound()
  }
  return reply(got.bytes, got.contentType)
}

/**
 * Fetches a target's artwork from upstream and stores it in R2; null when upstream has no usable
 * image, 'oversized' when what it has is over MAX_IMAGE_BYTES.
 */
async function fetchAndStore(
  deps: AppDeps,
  target: Target,
  source: { url: string; headers?: Record<string, string> }
): Promise<{ bytes: ArrayBuffer; contentType: string } | 'oversized' | null> {
  let bytes: ArrayBuffer
  let contentType: string
  try {
    // Stored Yugipedia URLs are on ms, which only redirects to img now.
    const res = await deps.fetch(yugipediaFetchUrl(source.url), {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      redirect: 'manual', // the prefix check covers only the first hop
      ...(source.headers && { headers: source.headers })
    })
    contentType = mediaType(res.headers.get('content-type') ?? '')
    if (!res.ok || !IMAGE_TYPES.has(contentType)) return null
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return 'oversized'
    bytes = await res.arrayBuffer()
  } catch {
    return null
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) return 'oversized'
  if (bytes.byteLength === 0) return null
  if (target.upright && contentType === 'image/jpeg') {
    const turned = uprightJpeg(new Uint8Array(bytes))
    if (turned)
      bytes = turned.buffer.slice(
        turned.byteOffset,
        turned.byteOffset + turned.byteLength
      ) as ArrayBuffer
  }
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
  const got = await fetchAndStore(deps, target, source)
  return got && got !== 'oversized' ? 'stored' : 'failed'
}

// ---- Magic set symbols ------------------------------------------------------------------------

/** A PNG starts with these eight bytes, then its IHDR chunk. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const IHDR = [0x49, 0x48, 0x44, 0x52]

/** A Magic set symbol key the portal accepts: 'ms-', the set key alphabet, and no longer than any set key. */
export const isSetSymbolKey = (key: string): boolean =>
  key.startsWith(MTG_SYMBOL_KEY_PREFIX) && key.length <= MAX_SET_KEY && SET_KEY_RE.test(key)

/** True when `bytes` open as a PNG does: the signature, then an IHDR chunk. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b) && IHDR.every((b, i) => bytes[12 + i] === b)
}

/** Admin only (the nightly job): the symbol keys of `keys` that R2 doesn't hold yet. */
export async function missingSetSymbols(deps: AppDeps, keys: string[]): Promise<string[]> {
  const held = await Promise.all(
    keys.map(async (key) => {
      const stored = await deps.images.get(`set/${key}`).catch(() => null)
      if (!stored) return false
      try {
        await stored.body.cancel() // only its presence matters
      } catch {
        // already read or closed
      }
      return true
    })
  )
  return keys.filter((_, i) => !held[i])
}

export type StoreSymbolResult = 'stored' | 'not-png' | 'too-large' | 'failed'

/**
 * Admin only (the nightly job): keeps a Magic set symbol, already turned into a PNG by the job, in
 * R2 under its set key. Only PNG bytes (checked, not taken from a header) up to
 * MAX_SYMBOL_PNG_BYTES are kept, and always as image/png: no SVG is ever stored or served.
 */
export async function storeSetSymbol(
  deps: AppDeps,
  key: string,
  bytes: ArrayBuffer
): Promise<StoreSymbolResult> {
  if (bytes.byteLength > MAX_SYMBOL_PNG_BYTES) return 'too-large'
  if (!isPng(new Uint8Array(bytes))) return 'not-png'
  try {
    await deps.images.put(`set/${key}`, bytes, { httpMetadata: { contentType: 'image/png' } })
    return 'stored'
  } catch {
    return 'failed'
  }
}
