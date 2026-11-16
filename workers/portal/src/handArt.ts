import {
  adminAuthorized,
  isJpegBytes,
  isPngBytes,
  MAX_THUMB_BYTES,
  type ThumbBucket
} from './thumbs'

/** A full-size card JPEG or pack PNG is never this big; anything over it is refused. */
const MAX_HIGH_BYTES = 4 * 1024 * 1024

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const PATH_RE = /^\/api\/admin\/hand-art\/([^/]+)\/(high|low|pack)$/
/** As the image route's HAND_PATH_RE allows: what /img/hand/<id>/<file> can serve. */
const ID_RE = /^[a-z0-9-]+$/

/**
 * PUT /api/admin/hand-art/<id>/(high|low|pack), for the catalog job's copies of art we keep
 * ourselves (Simplified Chinese cards and packs), behind the admin token. Stores a card's JPEGs as
 * `hand/<id>/high.jpg` and `hand/<id>/low.jpg`, and a pack's see-through PNG as
 * `hand/<id>/pack.png`: the keys HAND_ART_PREFIX URLs are served from. Null for any other path.
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
  const pack = size === 'pack'
  const type = pack ? 'image/png' : 'image/jpeg'
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== type)
    return json({ error: 'unsupported-type' }, 415)
  const max = size === 'low' ? MAX_THUMB_BYTES : MAX_HIGH_BYTES
  // Refused before the body is read when the sender says it is too big; checked again after.
  if (Number(req.headers.get('content-length') ?? 0) > max) return json({ error: 'too-large' }, 413)
  const bytes = await req.arrayBuffer()
  if (bytes.byteLength > max) return json({ error: 'too-large' }, 413)
  const b = new Uint8Array(bytes)
  if (!(pack ? isPngBytes(b) : isJpegBytes(b))) return json({ error: 'unsupported-type' }, 415)
  await bucket.put(`hand/${id}/${pack ? 'pack.png' : `${size}.jpg`}`, bytes, {
    httpMetadata: { contentType: type }
  })
  return json({ ok: true })
}
