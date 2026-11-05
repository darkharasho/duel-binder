/**
 * Opening the owner's /admin dashboard from the desktop and phone apps, which sign in with a
 * Bearer token, not the web session cookie the dashboard reads. The app asks for a one-time link
 * (POST /api/admin/handoff, Bearer only, admin accounts only) and opens it in a
 * browser window; GET /admin/open?code= spends the code on a short web session and lands on
 * /admin. Anyone else gets the same 404 as /admin itself.
 */
import type { AppDeps } from './app'
import { cookie, currentUser, isAdminUser, randomToken, sha256Hex } from './auth'

/** How long a link may wait before it's opened. */
const CODE_TTL_MS = 60_000
/** The web session a link opens: long enough for a look around, not a standing sign-in. */
export const HANDOFF_SESSION_SECONDS = 12 * 60 * 60
const CODE_RE = /^[A-Za-z0-9_-]{43}$/

const notFound = (): Response =>
  new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' }
  })

/** POST /api/admin/handoff: `{ url }`, a one-time /admin/open link for the owner's app. */
export async function adminHandoffRoute(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return notFound()
  const user = await currentUser(req, deps)
  if (!user || user.kind !== 'desktop' || !isAdminUser(deps, user.id)) return notFound()
  const now = deps.now()
  const code = randomToken()
  deps.db.prepare('DELETE FROM admin_handoffs WHERE expires_at <= ?').run(now.toISOString())
  deps.db
    .prepare('INSERT INTO admin_handoffs (code_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(await sha256Hex(code), user.id, new Date(now.getTime() + CODE_TTL_MS).toISOString())
  const url = `${new URL(deps.env.PUBLIC_URL).origin}/admin/open?code=${code}`
  return new Response(JSON.stringify({ url }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })
}

/** GET /admin/open?code=: spends the code on a web session and redirects to /admin. */
export async function adminOpenRoute(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'GET') return notFound()
  const code = new URL(req.url).searchParams.get('code') ?? ''
  if (!CODE_RE.test(code)) return notFound()
  const codeHash = await sha256Hex(code)
  const now = deps.now()
  const row = deps.db
    .prepare('SELECT user_id, expires_at FROM admin_handoffs WHERE code_hash = ?')
    .get(codeHash) as { user_id: number; expires_at: string } | undefined
  deps.db.prepare('DELETE FROM admin_handoffs WHERE code_hash = ?').run(codeHash)
  // The account may have stopped being the owner's since the code was made.
  if (!row || Date.parse(row.expires_at) <= now.getTime() || !isAdminUser(deps, row.user_id))
    return notFound()
  const secret = randomToken()
  deps.db
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
    )
    .run(
      await sha256Hex(secret),
      row.user_id,
      now.toISOString(),
      new Date(now.getTime() + HANDOFF_SESSION_SECONDS * 1000).toISOString()
    )
  const res = new Response(null, {
    status: 302,
    headers: { location: '/admin', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
  })
  res.headers.append('set-cookie', cookie('session', secret, HANDOFF_SESSION_SECONDS))
  return res
}
