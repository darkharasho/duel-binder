import type { AppDeps } from './app'
import { currentUser, fromPublicOrigin, isAdminUser } from './auth'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface AdminRow {
  userId: number
  username: string
  displayName: string | null
  addedAt: string
  /** How the account signs in, e.g. "discord,email". */
  signIns: string
}

const SELECT_ADMINS = `SELECT a.user_id AS userId, u.username AS username, u.display_name AS displayName,
       a.added_at AS addedAt,
       COALESCE((SELECT GROUP_CONCAT(provider, ',') FROM (SELECT DISTINCT provider FROM sign_ins s
                  WHERE s.user_id = a.user_id ORDER BY provider)), '') AS signIns
  FROM admins a JOIN users u ON u.id = a.user_id
 WHERE u.closed_at IS NULL
 ORDER BY a.added_at, a.user_id`

/**
 * GET /admin/admins, POST /admin/admins ({username}) and POST /admin/admins/remove ({userId}):
 * the accounts that may open the dashboard. Admin-only, otherwise 404. The last admin can't be
 * removed, so the dashboard never locks everyone out.
 */
export async function adminAdminsRoute(req: Request, deps: AppDeps): Promise<Response> {
  const { db } = deps
  const path = new URL(req.url).pathname
  const notFound = json({ error: 'Not found' }, 404)
  const me = await currentUser(req, deps)
  if (!me || !isAdminUser(deps, me.id)) return notFound
  const list = (): AdminRow[] => db.prepare(SELECT_ADMINS).all() as AdminRow[]
  if (req.method === 'GET' && path === '/admin/admins') return json({ admins: list(), you: me.id })
  if (req.method !== 'POST' || (path !== '/admin/admins' && path !== '/admin/admins/remove'))
    return notFound
  if (!fromPublicOrigin(req, deps)) return notFound
  const type = req.headers.get('content-type')
  if (type === null || type.split(';')[0].trim().toLowerCase() !== 'application/json')
    return json({ error: 'unsupported-media-type' }, 415)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (body === null || typeof body !== 'object') return json({ error: 'Bad request' }, 400)

  if (path === '/admin/admins/remove') {
    const { userId } = body
    if (typeof userId !== 'number' || !Number.isInteger(userId))
      return json({ error: 'Bad request' }, 400)
    const removed = db.transaction((): boolean => {
      const others = list().filter((a) => a.userId !== userId)
      if (others.length === 0) return false
      db.prepare('DELETE FROM admins WHERE user_id = ?').run(userId)
      return true
    })()
    if (!removed) return json({ error: 'last-admin' }, 400)
    return json({ admins: list(), you: me.id })
  }

  const { username } = body
  if (typeof username !== 'string' || username.trim() === '')
    return json({ error: 'Bad request' }, 400)
  const user = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND closed_at IS NULL')
    .get(username.trim().replace(/^@/, '')) as { id: number } | undefined
  if (!user) return json({ error: 'no-such-user' }, 404)
  db.prepare('INSERT OR IGNORE INTO admins (user_id, added_at) VALUES (?, ?)').run(
    user.id,
    deps.now().toISOString()
  )
  return json({ admins: list(), you: me.id })
}
