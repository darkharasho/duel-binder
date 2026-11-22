import { isGameId } from '../../../src/shared/games'
import { parseRulesPack } from '../../../src/shared/decks/pack'
import type { SnapshotBucket } from './catalogSnapshot'
import { adminAuthorized } from './thumbs'

/** R2 as the rules pack route uses it; a real object carries `httpEtag`. */
export interface RulesBucket {
  get(key: string): Promise<{ body: ReadableStream; size: number; httpEtag?: string } | null>
  put: SnapshotBucket['put']
}

const GET_PREFIX = '/api/rules/'
const ADMIN_PREFIX = '/api/admin/rules/'
const CACHE_CONTROL = 'public, max-age=3600'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const keyOf = (game: string): string => `rules/${game}.json`

async function etagOf(text: string, httpEtag: string | undefined): Promise<string> {
  if (httpEtag) return httpEtag
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
  return `"${hex}"`
}

/** Each etag in an If-None-Match list, weak marks and quotes ignored; `*` matches any. */
function matches(header: string | null, etag: string): boolean {
  if (!header) return false
  const bare = (s: string): string => s.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  return header
    .split(',')
    .some((t) => t.trim() === '*' || (bare(t) !== '' && bare(t) === bare(etag)))
}

async function serve(
  req: Request,
  bucket: RulesBucket,
  game: string,
  cache: Cache | null
): Promise<Response> {
  // Keyed without the query string: one copy per game, the one a PUT purges.
  const url = new URL(req.url)
  url.search = ''
  const cacheKey = new Request(url.toString(), { method: 'GET' })
  let res = (await cache?.match(cacheKey)) ?? null
  if (!res) {
    const obj = await bucket.get(keyOf(game))
    if (!obj) return new Response('not found', { status: 404 })
    const text = await new Response(obj.body).text()
    res = new Response(text, {
      headers: {
        'content-type': 'application/json',
        etag: await etagOf(text, obj.httpEtag),
        'cache-control': CACHE_CONTROL
      }
    })
    await cache?.put(cacheKey, res.clone())
  }
  const etag = res.headers.get('etag')
  if (etag && matches(req.headers.get('if-none-match'), etag))
    return new Response(null, { status: 304, headers: { etag, 'cache-control': CACHE_CONTROL } })
  return res
}

async function putPack(
  req: Request,
  bucket: RulesBucket,
  game: string,
  cache: Cache | null
): Promise<Response> {
  const text = await req.text()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return json({ error: 'bad-body' }, 400)
  }
  const state = parseRulesPack(raw)
  if (state.state !== 'ready' || state.pack.game !== game) return json({ error: 'bad-pack' }, 400)
  await bucket.put(keyOf(game), text)
  await cache?.delete(
    new Request(new URL(GET_PREFIX + game, req.url).toString(), { method: 'GET' })
  )
  return json({ ok: true })
}

/** The rules pack: GET for every client, an admin PUT the catalog job publishes with. Null for other paths. */
export async function rulesPackRoute(
  req: Request,
  bucket: RulesBucket,
  adminToken: string | undefined,
  cache: Cache | null
): Promise<Response | null> {
  const path = new URL(req.url).pathname
  if (path.startsWith(GET_PREFIX) && (req.method === 'GET' || req.method === 'HEAD')) {
    const game = path.slice(GET_PREFIX.length)
    return isGameId(game)
      ? serve(req, bucket, game, cache)
      : new Response('not found', { status: 404 })
  }
  if (path.startsWith(ADMIN_PREFIX) && req.method === 'PUT') {
    if (!(await adminAuthorized(req, adminToken))) return json({ error: 'unauthorized' }, 401)
    const game = path.slice(ADMIN_PREFIX.length)
    return isGameId(game) ? putPack(req, bucket, game, cache) : json({ error: 'not-found' }, 404)
  }
  return null
}
