import { adminAuthorized, isJpegBytes, MAX_THUMB_BYTES, type ThumbBucket } from './thumbs'

/** A full-size card or pack JPEG is never this big; anything over it is refused. */
const MAX_HIGH_BYTES = 4 * 1024 * 1024

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const PATH_RE = /^\/api\/admin\/hand-art\/([^/]+)\/(high|low)$/
/** As the image route's HAND_PATH_RE allows: what /img/hand/<id>/<file> can serve. */
const ID_RE = /^[a-z0-9-]+$/

/**
 * PUT /api/admin/hand-art/<id>/(high|low), for the catalog job's copies of art we keep ourselves
 * (Simplified Chinese cards and packs), behind the admin token. Stores the JPEG as
 * `hand/<id>/high.jpg` or `hand/<id>/low.jpg`, the keys HAND_ART_PREFIX URLs are served from.
 * Null for any other path.
 */
export async function handArtRoute(
  req: Request,
  bucket: Pick<ThumbBucket, 'put'>,
  adminToken: string | undefined
): Promise<Response | null> {
  const m = PATH_RE.exec(new URL(req.url).pathname)
  if (!m || req.method !== 'PUT') return null
  if (!(await adminAuthorized(req, adminToken))) return json({ error: 'unauthorized' }, 401)
  const [, id, size] = m
  if (!ID_RE.test(id)) return json({ error: 'bad-id' }, 400)
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg')
    return json({ error: 'unsupported-type' }, 415)
  const max = size === 'high' ? MAX_HIGH_BYTES : MAX_THUMB_BYTES
  // Refused before the body is read when the sender says it is too big; checked again after.
  if (Number(req.headers.get('content-length') ?? 0) > max) return json({ error: 'too-large' }, 413)
  const bytes = await req.arrayBuffer()
  if (bytes.byteLength > max) return json({ error: 'too-large' }, 413)
  if (!isJpegBytes(new Uint8Array(bytes))) return json({ error: 'unsupported-type' }, 415)
  await bucket.put(`hand/${id}/${size}.jpg`, bytes, { httpMetadata: { contentType: 'image/jpeg' } })
  return json({ ok: true })
}
