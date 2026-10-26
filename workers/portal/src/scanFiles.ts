import { decodeFingerprints } from '../../../src/shared/scan/fingerprintFile'
import type { AppDeps } from './app'

const FINGERPRINTS_KEY = 'scan/fingerprints.bin'
const MAX_FINGERPRINT_BYTES = 8 * 1024 * 1024

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Admin upload: stores the art-fingerprint file once it decodes and fits the size limit. */
export async function putFingerprints(req: Request, deps: AppDeps): Promise<Response> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_FINGERPRINT_BYTES) return json({ error: 'File is too large' }, 400)
  const bytes = await req.arrayBuffer()
  if (bytes.byteLength > MAX_FINGERPRINT_BYTES) return json({ error: 'File is too large' }, 400)
  let count: number
  try {
    count = decodeFingerprints(bytes).count
  } catch {
    return json({ error: 'Not a fingerprint file' }, 400)
  }
  await deps.images.put(FINGERPRINTS_KEY, bytes, {
    httpMetadata: { contentType: 'application/octet-stream' }
  })
  return json({ ok: true, count })
}

/** Public download of the fingerprint file; clients revalidate by ETag. */
export async function getFingerprints(req: Request, deps: AppDeps): Promise<Response> {
  const object = await deps.images.get(FINGERPRINTS_KEY)
  if (!object) return json({ error: 'No fingerprints yet' }, 404)
  const headers = new Headers({ 'cache-control': 'no-cache' })
  if (object.httpEtag) headers.set('etag', object.httpEtag)
  if (object.httpEtag && req.headers.get('if-none-match') === object.httpEtag) {
    await object.body.cancel()
    return new Response(null, { status: 304, headers })
  }
  headers.set('content-type', 'application/octet-stream')
  return new Response(object.body, { status: 200, headers })
}
