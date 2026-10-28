import type { AppDeps } from './app'
import { revokeAppleToken } from './apple'
import { clearSessionCookie, currentUser, fromPublicOrigin } from './auth'

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

/**
 * POST /api/account/delete `{ "confirm": "delete" }`, with a Bearer token or the web session
 * cookie (whose request must come from PUBLIC_URL's origin). Deletes the signed-in user and
 * everything the server keeps for them, in one transaction:
 * - `collection_entries` and `value_snapshots` don't cascade from `users`, so they go first;
 * - deleting the `users` row cascades to sessions, desktop_codes, friendships,
 *   friend_request_log, friend_blocks and printing_contributions (foreign keys are always on
 *   in a Durable Object).
 * One statement per table: Durable Object SQLite rejects large compound queries.
 * A Sign in with Apple account's refresh token is then revoked with Apple, as App Review asks;
 * the account is gone either way, so a failed revoke is only logged.
 */
export async function deleteAccountRoute(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json', allow: 'POST' }
    })
  const user = await currentUser(req, deps)
  if (!user) return json({ error: 'signed-out' }, 401)
  if (user.kind === 'web' && !fromPublicOrigin(req, deps)) return json({ error: 'bad-origin' }, 403)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (body as { confirm?: unknown }).confirm !== 'delete'
  )
    return json({ error: 'confirm' }, 400)

  const userId = user.id
  const apple = deps.db
    .prepare('SELECT refresh_token FROM apple_tokens WHERE user_id = ?')
    .get(userId) as { refresh_token: string } | undefined
  deps.db.transaction(() => {
    deps.db.prepare('DELETE FROM collection_entries WHERE user_id = ?').run(userId)
    deps.db.prepare('DELETE FROM value_snapshots WHERE user_id = ?').run(userId)
    deps.db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  })()
  if (apple) {
    const revoked = await revokeAppleToken(apple.refresh_token, deps).catch(() => false)
    if (!revoked) console.warn('Apple token revoke failed for a deleted account')
  }

  const res = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  res.headers.append('set-cookie', clearSessionCookie())
  return res
}
