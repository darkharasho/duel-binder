import {
  imageUrl,
  PACK_ART_PREFIX,
  SET_KEY_RE,
  setImageUrl,
  YUGIPEDIA_IMAGE_PREFIX,
  type ImageSize
} from '../../../src/shared/imageSources'
import { findSetImageUrl } from '../../../src/main/repo/sets'
import type { AppDeps } from './app'

/** The slice of an R2 bucket the image route uses. */
export interface ImageBucket {
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>
  put(key: string, value: ArrayBuffer, opts: { httpMetadata: { contentType: string } }): Promise<unknown>
}

const IMAGE_TIMEOUT_MS = 30_000
const USER_AGENT = 'DuelBinder/portal (https://github.com/darkharasho/duel-binder)'
const CARD_CACHE = 'public, max-age=31536000, immutable'
const SET_CACHE = 'public, max-age=86400'

const notFound = (): Response => new Response('Not found', { status: 404 })

/** Where a request's artwork comes from and how long browsers may keep it; null when the path names nothing servable. */
function resolve(deps: AppDeps, path: string): { key: string; source: string; headers?: Record<string, string>; cache: string } | null {
  const [kind, id, ...rest] = path.split('/')
  if (id === undefined || rest.length > 0) return null
  if (kind === 'small' || kind === 'full' || kind === 'cropped') {
    if (!/^\d+$/.test(id)) return null
    const n = Number(id)
    if (!Number.isSafeInteger(n) || n <= 0) return null
    if (!deps.db.prepare('SELECT 1 FROM card_images WHERE image_id = ?').get(n)) return null
    return { key: `card/${kind satisfies ImageSize}/${n}`, source: imageUrl(kind, n), cache: CARD_CACHE }
  }
  if (kind === 'set') {
    if (!SET_KEY_RE.test(id)) return null
    const prefix = id.slice(0, 3)
    if (prefix === 'km-') return null
    if (prefix === 'yp-' || prefix === 'yc-') {
      const source = findSetImageUrl(deps.db, id)
      const allowed = prefix === 'yp-' ? YUGIPEDIA_IMAGE_PREFIX : PACK_ART_PREFIX
      if (source === null || !source.startsWith(allowed)) return null
      return { key: `set/${id}`, source, headers: { 'User-Agent': USER_AGENT }, cache: SET_CACHE }
    }
    return { key: `set/${id}`, source: setImageUrl(id), cache: SET_CACHE }
  }
  return null // printing/<id> arrives with the printing route
}

/** GET/HEAD /img/<path>: artwork mirrored into R2 on first request, so the web build never hotlinks its sources. */
export async function imageRoute(req: Request, deps: AppDeps, path: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const target = resolve(deps, path)
  if (!target) return notFound()

  const reply = (body: BodyInit | null, contentType: string): Response =>
    new Response(req.method === 'HEAD' ? null : body, {
      headers: { 'content-type': contentType, 'cache-control': target.cache }
    })

  const stored = await deps.images.get(target.key)
  if (stored) return reply(stored.body, stored.httpMetadata?.contentType ?? 'image/jpeg')

  let bytes: ArrayBuffer
  let contentType: string
  try {
    const res = await deps.fetch(target.source, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      ...(target.headers && { headers: target.headers })
    })
    contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.toLowerCase().startsWith('image/')) return notFound()
    bytes = await res.arrayBuffer()
  } catch {
    return notFound()
  }
  if (bytes.byteLength === 0) return notFound()
  await deps.images.put(target.key, bytes, { httpMetadata: { contentType } })
  return reply(bytes, contentType)
}
