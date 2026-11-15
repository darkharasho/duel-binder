import { isGameId } from '../../../src/shared/games'
import {
  snapshotFileKey,
  snapshotManifestKey,
  type SnapshotManifest
} from '../../../src/shared/catalogSnapshot'
import { adminAuthorized } from './thumbs'

/** The parts of R2 the snapshot routes use. */
export interface SnapshotBucket {
  get(
    key: string,
    opts?: { range?: { offset: number; length?: number } }
  ): Promise<{ body: ReadableStream; size: number } | null>
  head(key: string): Promise<{ size: number; uploaded: Date } | null>
  put(key: string, value: string | ArrayBuffer, opts?: unknown): Promise<unknown>
  list(opts: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string; size: number; uploaded: Date }[]
    truncated: boolean
    cursor?: string
  }>
  delete(key: string): Promise<void>
  createMultipartUpload(key: string): Promise<SnapshotUpload>
  resumeMultipartUpload(key: string, uploadId: string): SnapshotUpload
}

interface SnapshotUpload {
  uploadId: string
  uploadPart(
    n: number,
    body: ReadableStream | ArrayBuffer | Uint8Array
  ): Promise<{ partNumber: number; etag: string }>
  complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>
}

/** How long a signed download URL works. */
const URL_TTL_S = 3600
/** Files of a shape the manifest no longer names are kept this long after, for downloads under way. */
const KEEP_OLD_MS = 7 * 86_400_000
const KEY_RE = /^catalog-snapshots\/[a-z]+\/[0-9a-f]{8}\/\d+\.sqlite\.gz$/
const FILE_PREFIX = '/api/catalog/snapshot-file/'
const ADMIN_PREFIX = '/api/admin/catalog-snapshot/'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const b64url = (b: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromB64url = (s: string): Uint8Array<ArrayBuffer> | null => {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(new ArrayBuffer(bin.length))
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** The URL-signing key, derived from the admin token so there is no extra secret to keep. */
const signingKey = (adminToken: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`catalog-snapshot-url:${adminToken}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )

const signed = (key: string, exp: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new TextEncoder().encode(`${key}\n${exp}`))

/** A download URL for `key`, good for an hour from `now` (ms). */
export async function signSnapshotUrl(
  origin: string,
  key: string,
  adminToken: string,
  now: number
): Promise<string> {
  const exp = Math.floor(now / 1000) + URL_TTL_S
  const sig = await crypto.subtle.sign('HMAC', await signingKey(adminToken), signed(key, exp))
  return `${origin}${FILE_PREFIX}${key}?exp=${exp}&sig=${b64url(sig)}`
}

async function signatureValid(
  key: string,
  q: URLSearchParams,
  adminToken: string,
  now: number
): Promise<boolean> {
  const exp = Number(q.get('exp'))
  const sig = fromB64url(q.get('sig') ?? '')
  if (!Number.isSafeInteger(exp) || exp * 1000 < now || !sig) return false
  return crypto.subtle.verify('HMAC', await signingKey(adminToken), sig, signed(key, exp))
}

/** `bytes=a-` or `bytes=a-b`; null for no or unusable ranges (served whole). */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header ? /^bytes=(\d+)-(\d*)$/.exec(header.trim()) : null
  if (!m) return null
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  return start <= end ? { start, end } : null
}

async function serveFile(
  req: Request,
  bucket: SnapshotBucket,
  adminToken: string,
  now: number
): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'method-not-allowed' }, 405)
  const url = new URL(req.url)
  let key: string
  try {
    key = decodeURIComponent(url.pathname.slice(FILE_PREFIX.length))
  } catch {
    return json({ error: 'forbidden' }, 403)
  }
  if (!KEY_RE.test(key) || !(await signatureValid(key, url.searchParams, adminToken, now)))
    return json({ error: 'forbidden' }, 403)
  const head = await bucket.head(key)
  if (!head) return json({ error: 'Not found' }, 404)
  const range = parseRange(req.headers.get('range'), head.size)
  const obj = await bucket.get(
    key,
    range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined
  )
  if (!obj) return json({ error: 'Not found' }, 404)
  const headers: Record<string, string> = {
    'content-type': 'application/gzip',
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store'
  }
  if (!range)
    return new Response(obj.body, { headers: { ...headers, 'content-length': String(head.size) } })
  return new Response(obj.body, {
    status: 206,
    headers: {
      ...headers,
      'content-length': String(range.end - range.start + 1),
      'content-range': `bytes ${range.start}-${range.end}/${head.size}`
    }
  })
}

const isManifest = (m: unknown): m is SnapshotManifest => {
  const o = m as Partial<SnapshotManifest> | null
  return (
    !!o &&
    typeof o.game === 'string' &&
    isGameId(o.game) &&
    typeof o.shape === 'string' &&
    /^[0-9a-f]{8}$/.test(o.shape) &&
    Number.isSafeInteger(o.cursor) &&
    Number.isSafeInteger(o.bytes) &&
    typeof o.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(o.sha256) &&
    typeof o.builtAt === 'string' &&
    (o.builder === undefined ||
      (typeof o.builder === 'string' && /^[0-9a-f]{12}$/.test(o.builder))) &&
    (o.dbVersion === null || typeof o.dbVersion === 'string') &&
    o.key === snapshotFileKey(o.game, o.shape, o.cursor!)
  )
}

/**
 * Deletes this shape's files the manifest doesn't name, a week after it stopped naming them (for
 * downloads under way). When each was retired is kept in the shape's `retired.json`; a file it
 * doesn't list is retired now.
 */
async function prune(bucket: SnapshotBucket, m: SnapshotManifest, now: number): Promise<void> {
  const prefix = snapshotManifestKey(m.game, m.shape).replace(/manifest\.json$/, '')
  const retiredKey = `${prefix}retired.json`
  const saved = await bucket.get(retiredKey)
  const was = saved
    ? ((await new Response(saved.body).json().catch(() => ({}))) as Record<string, unknown>)
    : {}
  const retired: Record<string, number> = {}
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    for (const o of page.objects) {
      if (o.key === m.key || !KEY_RE.test(o.key)) continue
      const at = typeof was[o.key] === 'number' ? (was[o.key] as number) : now
      if (now - at > KEEP_OLD_MS) await bucket.delete(o.key)
      else retired[o.key] = at
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  await bucket.put(retiredKey, JSON.stringify(retired), {
    httpMetadata: { contentType: 'application/json' }
  })
}

async function admin(
  req: Request,
  bucket: SnapshotBucket,
  action: string,
  now: number
): Promise<Response> {
  const q = new URL(req.url).searchParams
  if (action === 'manifest') {
    if (req.method !== 'PUT') return json({ error: 'method-not-allowed' }, 405)
    const m = await req.json().catch(() => null)
    if (!isManifest(m)) return json({ error: 'bad-manifest' }, 400)
    const head = await bucket.head(m.key)
    if (!head || head.size !== m.bytes) return json({ error: 'file-missing' }, 400)
    await bucket.put(snapshotManifestKey(m.game, m.shape), JSON.stringify(m), {
      httpMetadata: { contentType: 'application/json' }
    })
    await prune(bucket, m, now)
    return json({ ok: true })
  }
  const key = q.get('key') ?? ''
  if (!KEY_RE.test(key)) return json({ error: 'bad-key' }, 400)
  const uploadId = q.get('uploadId')
  if (action === 'upload' && req.method === 'POST') {
    const up = await bucket.createMultipartUpload(key)
    return json({ uploadId: up.uploadId })
  }
  if (!uploadId) return json({ error: 'bad-request' }, 400)
  if (action === 'upload' && req.method === 'PUT') {
    const part = Number(q.get('part'))
    if (!Number.isSafeInteger(part) || part < 1 || part > 10_000 || !req.body)
      return json({ error: 'bad-part' }, 400)
    const done = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(part, req.body)
    return json({ etag: done.etag })
  }
  if (action === 'complete' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as {
      parts?: { partNumber: number; etag: string }[]
    } | null
    if (!body || !Array.isArray(body.parts) || body.parts.length === 0)
      return json({ error: 'bad-parts' }, 400)
    await bucket.resumeMultipartUpload(key, uploadId).complete(body.parts)
    return json({ ok: true })
  }
  return json({ error: 'method-not-allowed' }, 405)
}

/**
 * Catalog snapshot routes served by the Worker straight from R2, never the Durable Object; null
 * for any other path.
 *   GET  /api/catalog/snapshot-file/<key>?exp&sig        a signed download (Range supported)
 *   POST /api/admin/catalog-snapshot/upload?key           starts a multipart upload (admin token)
 *   PUT  /api/admin/catalog-snapshot/upload?key&uploadId&part   one part
 *   POST /api/admin/catalog-snapshot/complete?key&uploadId      body {parts}
 *   PUT  /api/admin/catalog-snapshot/manifest            publishes a manifest, prunes old files
 * The manifest itself is offered by /api/catalog/snapshot/<game>, which needs a desktop session.
 */
export async function catalogSnapshotRoute(
  req: Request,
  bucket: SnapshotBucket,
  adminToken: string | undefined,
  now: () => number = Date.now
): Promise<Response | null> {
  const path = new URL(req.url).pathname
  if (path.startsWith(FILE_PREFIX)) {
    if (!adminToken) return json({ error: 'forbidden' }, 403)
    return serveFile(req, bucket, adminToken, now())
  }
  if (!path.startsWith(ADMIN_PREFIX)) return null
  if (!(await adminAuthorized(req, adminToken))) return json({ error: 'unauthorized' }, 401)
  return admin(req, bucket, path.slice(ADMIN_PREFIX.length), now())
}

/** The manifest for `game` and `shape` with a signed URL; null when there is none. */
export async function snapshotOffer(
  bucket: { get(key: string): Promise<{ body: ReadableStream } | null> },
  game: string,
  shape: string,
  origin: string,
  adminToken: string,
  now: number
): Promise<(SnapshotManifest & { url: string }) | null> {
  if (!isGameId(game) || !/^[0-9a-f]{8}$/.test(shape)) return null
  const obj = await bucket.get(snapshotManifestKey(game, shape))
  if (!obj) return null
  const m = (await new Response(obj.body).json().catch(() => null)) as unknown
  if (!isManifest(m)) return null
  return { ...m, url: await signSnapshotUrl(origin, m.key, adminToken, now) }
}
