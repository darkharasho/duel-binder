import { gameOfId } from '../../../src/shared/games/ids'
import { adminAuthorized, isJpegBytes, isPngBytes, MAX_THUMB_BYTES, type ThumbBucket } from './thumbs'

/**
 * A full-size card PNG is never this big; anything over it is refused. Most are 600x838 and under
 * 300 KB, but OP02's are 868x1212 RGBA, about 2.3 MB.
 */
const MAX_FULL_BYTES = 4 * 1024 * 1024

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const PATH_RE = /^\/api\/admin\/op-art\/(full|small)\/(\d+)$/

/**
 * PUT /api/admin/op-art/(full|small)/<One Piece image id>, for the catalog job (onepiece/art.ts),
 * behind the admin token. Stores the PNG as `card/full/<id>` and the JPEG small copy as
 * `card/small/<id>`, the keys /img serves. Null for any other path.
 */
export async function opArtRoute(
  req: Request,
  bucket: Pick<ThumbBucket, 'put'>,
  adminToken: string | undefined
): Promise<Response | null> {
  const m = PATH_RE.exec(new URL(req.url).pathname)
  if (!m || req.method !== 'PUT') return null
  if (!(await adminAuthorized(req, adminToken))) return json({ error: 'unauthorized' }, 401)
  const size = m[1] as 'full' | 'small'
  const n = Number(m[2])
  if (!Number.isSafeInteger(n) || gameOfId(n) !== 'op') return json({ error: 'not-an-op-id' }, 400)
  const type = size === 'full' ? 'image/png' : 'image/jpeg'
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== type)
    return json({ error: 'unsupported-type' }, 415)
  const max = size === 'full' ? MAX_FULL_BYTES : MAX_THUMB_BYTES
  // Refused before the body is read when the sender says it is too big; checked again after.
  if (Number(req.headers.get('content-length') ?? 0) > max) return json({ error: 'too-large' }, 413)
  const bytes = await req.arrayBuffer()
  const b = new Uint8Array(bytes)
  if (bytes.byteLength > max) return json({ error: 'too-large' }, 413)
  if (!(size === 'full' ? isPngBytes(b) : isJpegBytes(b)))
    return json({ error: 'unsupported-type' }, 415)
  await bucket.put(`card/${size}/${n}`, bytes, { httpMetadata: { contentType: type } })
  return json({ ok: true })
}
