import { decodeFingerprints } from '../../../src/shared/scan/fingerprintFile'
import { isGameId, type GameId } from '../../../src/shared/games'
import { parseFingerprintRefs } from '../../../src/shared/scan/fingerprintRefs'
import type { AppDeps } from './app'

/**
 * Each game has its own file. Yu-Gi-Oh!'s keeps the original keys, so a client that never sends
 * `?game` keeps getting it.
 */
interface Keys {
  /** The file served. */
  current: string
  /** The file the last upload replaced, kept so a bad night can be rolled back. */
  previous: string
}
const KEYS: Record<GameId, Keys> = {
  ygo: { current: 'scan/fingerprints.bin', previous: 'scan/fingerprints.prev.bin' },
  pkm: { current: 'scan/pkm/fingerprints.bin', previous: 'scan/pkm/fingerprints.prev.bin' }
}
const MAX_FINGERPRINT_BYTES = 8 * 1024 * 1024
/** Which printings the fingerprint file's printing scans show (see fingerprintRefs.ts). */
const REFS_KEY = 'scan/fingerprint-refs.json'
const MAX_REFS_BYTES = 4 * 1024 * 1024
/**
 * An upload holding fewer than this share of the current file's records is refused unless the
 * request says `?force=1`: a night with failed image downloads must not shrink every client's
 * index. Clients replace their copy with whatever is served.
 */
export const MIN_KEPT_SHARE = 0.9

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The keys for the request's `?game` (none means Yu-Gi-Oh!); null for a game that isn't known. */
function keysOf(req: Request): Keys | null {
  const game = new URL(req.url).searchParams.get('game') ?? 'ygo'
  return isGameId(game) ? KEYS[game] : null
}

const BAD_GAME = (): Response => json({ error: 'Unknown game' }, 400)

const PUT_OPTS = { httpMetadata: { contentType: 'application/octet-stream' } }

async function stored(deps: AppDeps, key: string): Promise<ArrayBuffer | null> {
  const object = await deps.images.get(key)
  return object ? new Response(object.body).arrayBuffer() : null
}

/**
 * Admin upload: stores the art-fingerprint file once it decodes, fits the size limit, holds
 * records and doesn't shrink the current file past MIN_KEPT_SHARE (unless forced). The file it
 * replaces is kept as the previous copy.
 */
export async function putFingerprints(req: Request, deps: AppDeps): Promise<Response> {
  const keys = keysOf(req)
  if (!keys) return BAD_GAME()
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
  if (count === 0) return json({ error: 'The file holds no fingerprints' }, 400)
  const current = await stored(deps, keys.current)
  if (current) {
    let had = 0
    try {
      had = decodeFingerprints(current).count
    } catch {
      // A stored file that no longer decodes is replaced without a size check.
    }
    const force = new URL(req.url).searchParams.get('force') === '1'
    if (!force && count < had * MIN_KEPT_SHARE) {
      return json(
        { error: `Refusing to shrink the index from ${had} to ${count} fingerprints`, had, count },
        409
      )
    }
    await deps.images.put(keys.previous, current, PUT_OPTS)
  }
  await deps.images.put(keys.current, bytes, PUT_OPTS)
  return json({ ok: true, count })
}

/** Admin rollback: serves the previous upload again (and keeps the current one as previous). */
export async function rollbackFingerprints(req: Request, deps: AppDeps): Promise<Response> {
  const keys = keysOf(req)
  if (!keys) return BAD_GAME()
  const previous = await stored(deps, keys.previous)
  if (!previous) return json({ error: 'No previous fingerprint file' }, 404)
  const current = await stored(deps, keys.current)
  if (current) await deps.images.put(keys.previous, current, PUT_OPTS)
  await deps.images.put(keys.current, previous, PUT_OPTS)
  return json({ ok: true, count: decodeFingerprints(previous).count })
}

/**
 * Admin upload of the fingerprint refs file: stored once it parses and fits the size limit. It
 * goes with the fingerprint file uploaded just before it, and keys its refs by hash, so a client
 * holding another fingerprint file just finds fewer of them; no shrink check or rollback.
 */
export async function putFingerprintRefs(req: Request, deps: AppDeps): Promise<Response> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_REFS_BYTES) return json({ error: 'File is too large' }, 400)
  const bytes = await req.arrayBuffer()
  if (bytes.byteLength > MAX_REFS_BYTES) return json({ error: 'File is too large' }, 400)
  let count: number
  try {
    count = parseFingerprintRefs(new TextDecoder().decode(bytes)).refs.length
  } catch {
    return json({ error: 'Not a fingerprint refs file' }, 400)
  }
  await deps.images.put(REFS_KEY, bytes, { httpMetadata: { contentType: 'application/json' } })
  return json({ ok: true, count })
}

/** A stored scan file for download; clients revalidate by ETag. */
async function serve(
  req: Request,
  deps: AppDeps,
  key: string,
  type: string,
  missing: string
): Promise<Response> {
  const object = await deps.images.get(key)
  if (!object) return json({ error: missing }, 404)
  const headers = new Headers({ 'cache-control': 'no-cache' })
  if (object.httpEtag) headers.set('etag', object.httpEtag)
  if (object.httpEtag && req.headers.get('if-none-match') === object.httpEtag) {
    await object.body.cancel()
    return new Response(null, { status: 304, headers })
  }
  headers.set('content-type', type)
  return new Response(object.body, { status: 200, headers })
}

/** Public download of the request's game's fingerprint file. */
export async function getFingerprints(req: Request, deps: AppDeps): Promise<Response> {
  const keys = keysOf(req)
  if (!keys) return BAD_GAME()
  return serve(req, deps, keys.current, 'application/octet-stream', 'No fingerprints yet')
}

/** Public download of the fingerprint refs file. */
export const getFingerprintRefs = (req: Request, deps: AppDeps): Promise<Response> =>
  serve(req, deps, REFS_KEY, 'application/json', 'No fingerprint refs yet')
