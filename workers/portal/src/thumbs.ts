import { tokenMatches } from './catalogLoad'

/**
 * Small copies of printing photos for grids. The nightly catalog job (scripts/catalog/thumbs.ts)
 * lists the photos stored under `printing/`, downloads each one with no small copy yet (or whose
 * small copy was made from an older photo), shrinks it and stores it here as
 * `printing-small/<server printing id>`, noting the photo's key it was made from.
 * /img/printing-small/<id> serves the small copy, else the full photo (see edgeImage).
 */
export const PHOTO_PREFIX = 'printing/'
export const THUMB_PREFIX = 'printing-small/'
/** A small copy is never this big; anything over it is refused. */
export const MAX_THUMB_BYTES = 200 * 1024
const LIST_LIMIT = 1000

/** The slice of the R2 binding the admin routes use. */
export interface ThumbBucket {
  get(
    key: string
  ): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>
  put(
    key: string,
    value: ArrayBuffer,
    opts: { httpMetadata: { contentType: string }; customMetadata?: Record<string, string> }
  ): Promise<unknown>
  list(opts: {
    prefix: string
    cursor?: string
    limit?: number
    include?: ('customMetadata' | 'httpMetadata')[]
  }): Promise<{
    objects: { key: string; size: number; customMetadata?: Record<string, string> }[]
    truncated: boolean
    cursor?: string
  }>
}

/** The admin bearer token check shared by the admin routes. */
export async function adminAuthorized(
  req: Request,
  adminToken: string | undefined
): Promise<boolean> {
  const m = /^Bearer (.*)$/.exec(req.headers.get('authorization') ?? '')
  return !!adminToken && !!m && (await tokenMatches(m[1], adminToken))
}

export const isJpegBytes = (b: Uint8Array): boolean => b[0] === 0xff && b[1] === 0xd8
export const isPngBytes = (b: Uint8Array): boolean =>
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** `printing/<id><suffix>` names a photo; its id, or null. */
export function photoId(key: string): number | null {
  const m = /^printing\/(\d+)(?:[-_.][^/]*)?$/.exec(key)
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * /api/admin/thumbs/*, for the catalog job, behind the admin token; null for any other path.
 *   GET  list?prefix=printing/|printing-small/&cursor=  a page of stored keys (with `from` for small copies)
 *   GET  photo?key=printing/...                          a stored photo's bytes
 *   PUT  <id>  (x-thumb-from: the photo's key)           stores a small copy, JPEG only
 */
export async function thumbsRoute(
  req: Request,
  bucket: ThumbBucket,
  adminToken: string | undefined
): Promise<Response | null> {
  const url = new URL(req.url)
  const base = '/api/admin/thumbs/'
  if (!url.pathname.startsWith(base)) return null
  if (!(await adminAuthorized(req, adminToken)))
    return json({ error: 'unauthorized' }, 401)
  const rest = url.pathname.slice(base.length)

  if (req.method === 'GET' && rest === 'list') {
    const prefix = url.searchParams.get('prefix') ?? ''
    if (prefix !== PHOTO_PREFIX && prefix !== THUMB_PREFIX)
      return json({ error: 'bad prefix' }, 400)
    const page = await bucket.list({
      prefix,
      cursor: url.searchParams.get('cursor') || undefined,
      limit: LIST_LIMIT,
      ...(prefix === THUMB_PREFIX ? { include: ['customMetadata' as const] } : {})
    })
    return json({
      objects: page.objects.map((o) => ({
        key: o.key,
        size: o.size,
        ...(o.customMetadata?.from ? { from: o.customMetadata.from } : {})
      })),
      cursor: page.truncated ? (page.cursor ?? null) : null
    })
  }

  if (req.method === 'GET' && rest === 'photo') {
    const key = url.searchParams.get('key') ?? ''
    if (photoId(key) === null) return json({ error: 'bad key' }, 400)
    const got = await bucket.get(key)
    if (!got) return json({ error: 'not found' }, 404)
    return new Response(got.body, {
      headers: { 'content-type': got.httpMetadata?.contentType ?? 'application/octet-stream' }
    })
  }

  if (req.method === 'PUT' && /^\d+$/.test(rest)) {
    const id = Number(rest)
    const from = req.headers.get('x-thumb-from') ?? ''
    if (!Number.isSafeInteger(id) || id <= 0 || photoId(from) !== id)
      return json({ error: 'bad id' }, 400)
    const bytes = await req.arrayBuffer()
    const b = new Uint8Array(bytes)
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMB_BYTES || !isJpegBytes(b))
      return json({ error: 'bad image' }, 400)
    await bucket.put(`${THUMB_PREFIX}${id}`, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { from }
    })
    return json({ ok: true })
  }
  return json({ error: 'not found' }, 404)
}
