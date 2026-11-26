import { isGameId } from '../../../src/shared/games'
import {
  MAX_TRACE_FRAME_BYTES,
  MAX_TRACE_LOG_BYTES,
  MAX_TRACE_NOTE,
  TRACE_DAILY_CAP,
  TRACE_FILE_RE,
  TRACE_SESSION_RE,
  TRACE_UPLOAD_MS,
  traceFileKey,
  tracePrefix,
  type AdminTrace,
  type AdminTraceTester,
  type TraceFile,
  type TraceRow
} from '../../../src/shared/traces'
import type { AppDeps } from './app'
import { adminWriteAllowed, currentUser, isAdmin, isAdminUser } from './auth'
import { adminAuthorized } from './thumbs'
import { readTraceToken, signTraceToken } from './traceToken'

/** The slice of the R2 binding donated traces use. */
export interface TraceBucket {
  put(
    key: string,
    value: ArrayBuffer,
    opts: { httpMetadata: { contentType: string } }
  ): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream } | null>
  delete(keys: string | string[]): Promise<void>
  list(opts: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string; size: number }[]
    truncated: boolean
    cursor?: string
  }>
}

const DAY_MS = 24 * 60 * 60 * 1000

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })
const notFound = (): Response => json({ error: 'not-found' }, 404)

/** Whether this account traces its scans and may send them: a trace tester, or an admin. */
export function isTraceTester(deps: AppDeps, userId: number): boolean {
  return (
    isAdminUser(deps, userId) ||
    deps.db
      .prepare(
        'SELECT 1 FROM trace_testers t JOIN users u ON u.id = t.user_id WHERE t.user_id = ? AND u.closed_at IS NULL'
      )
      .get(userId) !== undefined
  )
}

const ROW = `t.id AS id, t.game AS game, t.session AS session, t.note AS note,
  t.app_version AS appVersion, t.files AS files, t.bytes AS bytes, t.created_at AS createdAt,
  t.done_at AS doneAt`

/** Every file of a trace in R2, a page of 1000 at a time. */
export async function traceFiles(bucket: TraceBucket, id: number): Promise<TraceFile[]> {
  const files: TraceFile[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await bucket.list({ prefix: tracePrefix(id), cursor })
    for (const o of page.objects)
      files.push({ name: o.key.slice(tracePrefix(id).length), size: o.size })
    if (!page.truncated || !page.cursor) return files
    cursor = page.cursor
  }
}

/** Deletes a trace's files from R2, 1000 keys a call. */
export async function deleteTraceFiles(bucket: TraceBucket, id: number): Promise<void> {
  const keys = (await traceFiles(bucket, id)).map((f) => traceFileKey(id, f.name))
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000))
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (type !== 'application/json') return null
  const body = (await req.json().catch(() => null)) as unknown
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

/**
 * /api/traces*, a trace tester sending a scan trace:
 *   GET    /api/traces            the caller's own traces, newest first
 *   POST   /api/traces            {game, session, note, appVersion}: starts one; its id and upload token
 *   POST   /api/traces/<id>/done  every file is in: counts them from R2
 *   DELETE /api/traces/<id>       the caller's own trace, files and all
 * The files themselves go to the Worker (traceUploadRoute), never through here. Anyone who isn't
 * a trace tester gets the same 404 as an unknown path.
 */
export async function tracesRoute(req: Request, deps: AppDeps, rest: string): Promise<Response> {
  const user = await currentUser(req, deps)
  if (!user) return json({ error: 'signed-out' }, 401)
  if (!isTraceTester(deps, user.id)) return notFound()
  // Desktop only: the web app has no scan trace, so a cookie never writes here.
  if (user.kind === 'web' && req.method !== 'GET') return notFound()
  const { db } = deps
  if (rest === '' && req.method === 'GET') {
    const rows = db
      .prepare(`SELECT ${ROW} FROM scan_traces t WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 50`)
      .all(user.id) as TraceRow[]
    return json({ traces: rows })
  }
  if (rest === '' && req.method === 'POST') {
    const body = await readJson(req)
    if (!body) return json({ error: 'bad-request' }, 400)
    const { game, session, note, appVersion } = body
    if (
      !isGameId(game) ||
      typeof session !== 'string' ||
      !TRACE_SESSION_RE.test(session) ||
      typeof note !== 'string' ||
      note.length > MAX_TRACE_NOTE ||
      typeof appVersion !== 'string' ||
      appVersion.length > 40
    )
      return json({ error: 'bad-request' }, 400)
    const secret = deps.env.ADMIN_TOKEN
    if (!secret) return json({ error: 'unavailable' }, 503)
    const now = deps.now()
    const since = new Date(now.getTime() - DAY_MS).toISOString()
    const id = db.transaction((): number | null => {
      const today = (
        db
          .prepare('SELECT COUNT(*) AS n FROM scan_traces WHERE user_id = ? AND created_at > ?')
          .get(user.id, since) as { n: number }
      ).n
      if (today >= TRACE_DAILY_CAP) return null
      return Number(
        db
          .prepare(
            `INSERT INTO scan_traces (user_id, game, session, note, app_version, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(user.id, game, session, note.trim(), appVersion, now.toISOString()).lastInsertRowid
      )
    })()
    if (id === null) return json({ error: 'daily-cap' }, 429)
    const token = await signTraceToken(secret, id, user.id, now.getTime() + TRACE_UPLOAD_MS)
    return json({ id, token })
  }
  const one = /^(\d+)(\/done)?$/.exec(rest)
  if (!one) return notFound()
  const id = Number(one[1])
  const owned = db
    .prepare('SELECT 1 FROM scan_traces WHERE id = ? AND user_id = ?')
    .get(id, user.id)
  if (!owned) return notFound()
  const bucket = deps.traces
  if (!bucket) return json({ error: 'unavailable' }, 503)
  if (one[2] && req.method === 'POST') {
    const files = await traceFiles(bucket, id)
    const bytes = files.reduce((n, f) => n + f.size, 0)
    db.prepare('UPDATE scan_traces SET files = ?, bytes = ?, done_at = ? WHERE id = ?').run(
      files.length,
      bytes,
      deps.now().toISOString(),
      id
    )
    return json({ id, files: files.length, bytes })
  }
  if (!one[2] && req.method === 'DELETE') {
    await deleteTraceFiles(bucket, id)
    db.prepare('DELETE FROM scan_traces WHERE id = ?').run(id)
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  }
  return notFound()
}

/**
 * The Worker's half: PUT /api/traces/<id>/files/<name> with the trace's upload token in
 * `x-trace-token`, the file as the body. Checked against the token alone and stored in R2, so a
 * long upload never holds up the Durable Object. Null for any other request.
 */
export async function traceUploadRoute(
  req: Request,
  bucket: Pick<TraceBucket, 'put'>,
  secret: string | undefined,
  now: number
): Promise<Response | null> {
  const m = /^\/api\/traces\/(\d+)\/files\/([^/]+)$/.exec(new URL(req.url).pathname)
  if (!m || req.method !== 'PUT') return null
  if (!secret) return json({ error: 'unavailable' }, 503)
  const token = await readTraceToken(secret, req.headers.get('x-trace-token') ?? '', now)
  if (!token || token.traceId !== Number(m[1])) return json({ error: 'bad-token' }, 403)
  const name = m[2]!
  if (!TRACE_FILE_RE.test(name)) return json({ error: 'bad-name' }, 400)
  const frame = name.endsWith('.jpg')
  const cap = frame ? MAX_TRACE_FRAME_BYTES : MAX_TRACE_LOG_BYTES
  if (Number(req.headers.get('content-length') ?? 0) > cap) return json({ error: 'too-big' }, 413)
  const body = await readCapped(req, cap)
  if (body === 'too-big') return json({ error: 'too-big' }, 413)
  if (frame && !(body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff))
    return json({ error: 'not-jpeg' }, 415)
  await bucket.put(traceFileKey(token.traceId, name), body.buffer as ArrayBuffer, {
    httpMetadata: { contentType: frame ? 'image/jpeg' : 'application/x-ndjson' }
  })
  return new Response(null, { status: 204 })
}

async function readCapped(req: Request, cap: number): Promise<Uint8Array | 'too-big'> {
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) {
      await reader.cancel().catch(() => undefined)
      return 'too-big'
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

const SELECT_TESTERS = `SELECT t.user_id AS userId, u.username AS username,
       u.display_name AS displayName, t.added_at AS addedAt
  FROM trace_testers t JOIN users u ON u.id = t.user_id
 WHERE u.closed_at IS NULL
 ORDER BY u.username COLLATE NOCASE`

/**
 * The owner's side, admin (signed in) or the admin token:
 *   GET  /admin/traces                      every donated trace, newest first
 *   GET  /admin/traces/<id>/files           its files
 *   GET  /admin/traces/<id>/files/<name>    one file
 *   POST /admin/traces/remove {id}          deletes one, files and all
 *   GET  /admin/trace-testers, POST /admin/trace-testers {username},
 *   POST /admin/trace-testers/remove {userId}
 * Anyone else gets 404.
 */
export async function adminTracesRoute(req: Request, deps: AppDeps): Promise<Response> {
  const token = await adminAuthorized(req, deps.env.ADMIN_TOKEN)
  if (!token && !(await isAdmin(req, deps))) return notFound()
  const { db } = deps
  const path = new URL(req.url).pathname
  const testers = (): AdminTraceTester[] => db.prepare(SELECT_TESTERS).all() as AdminTraceTester[]
  if (req.method === 'GET') {
    if (path === '/admin/trace-testers') return json({ testers: testers() })
    if (path === '/admin/traces') {
      const traces = db
        .prepare(
          `SELECT ${ROW}, t.user_id AS userId, u.username AS username
             FROM scan_traces t LEFT JOIN users u ON u.id = t.user_id
            ORDER BY t.id DESC LIMIT 200`
        )
        .all() as AdminTrace[]
      return json({ traces })
    }
    const files = /^\/admin\/traces\/(\d+)\/files(?:\/([^/]+))?$/.exec(path)
    if (!files) return notFound()
    const bucket = deps.traces
    if (!bucket) return json({ error: 'unavailable' }, 503)
    const id = Number(files[1])
    if (!db.prepare('SELECT 1 FROM scan_traces WHERE id = ?').get(id)) return notFound()
    if (!files[2]) return json({ files: await traceFiles(bucket, id) })
    if (!TRACE_FILE_RE.test(files[2])) return notFound()
    const object = await bucket.get(traceFileKey(id, files[2]))
    if (!object) return notFound()
    return new Response(object.body, {
      headers: {
        'content-type': files[2].endsWith('.jpg') ? 'image/jpeg' : 'application/x-ndjson',
        'cache-control': 'no-store'
      }
    })
  }
  if (req.method !== 'POST') return notFound()
  if (!token && !adminWriteAllowed(req, deps)) return notFound()
  const body = await readJson(req)
  if (!body) return json({ error: 'bad-request' }, 400)
  if (path === '/admin/traces/remove') {
    const id = body.id
    if (typeof id !== 'number' || !Number.isInteger(id)) return json({ error: 'bad-request' }, 400)
    const bucket = deps.traces
    if (!bucket) return json({ error: 'unavailable' }, 503)
    await deleteTraceFiles(bucket, id)
    db.prepare('DELETE FROM scan_traces WHERE id = ?').run(id)
    return json({ ok: true })
  }
  if (path === '/admin/trace-testers/remove') {
    const userId = body.userId
    if (typeof userId !== 'number' || !Number.isInteger(userId))
      return json({ error: 'bad-request' }, 400)
    db.prepare('DELETE FROM trace_testers WHERE user_id = ?').run(userId)
    return json({ testers: testers() })
  }
  if (path === '/admin/trace-testers') {
    const username = body.username
    if (typeof username !== 'string' || username.trim() === '')
      return json({ error: 'bad-request' }, 400)
    const user = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND closed_at IS NULL')
      .get(username.trim().replace(/^@/, '')) as { id: number } | undefined
    if (!user) return json({ error: 'no-such-user' }, 404)
    db.prepare('INSERT OR IGNORE INTO trace_testers (user_id, added_at) VALUES (?, ?)').run(
      user.id,
      deps.now().toISOString()
    )
    return json({ testers: testers() })
  }
  return notFound()
}
