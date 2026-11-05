import type { SqlDb } from '../../../src/main/db/sql'
import type { AppDeps } from './app'
import { revokeAppleToken } from './apple'
import { clearSessionCookie, currentUser, fromPublicOrigin } from './auth'
import { mergedFrom } from './merge'

/** The most keys one R2 delete call takes. */
const DELETE_BATCH = 1000

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

/**
 * Deletes one user and everything the server keeps for them. Call inside a transaction.
 * - `collection_entries` and `value_snapshots` don't cascade from `users`, so they go first;
 * - deleting the `users` row cascades to sessions, desktop_codes, friendships,
 *   friend_request_log, friend_blocks, printing_contributions, price_request_log, wishlist_entries,
 *   binders, binder_edits, scan_sessions, favourites, sign_ins, apple_tokens, account_change_log, merge_tickets
 *   and training_photos (foreign keys are always on in a Durable Object); deleteAccountRoute
 *   deletes the training photos' R2 objects.
 * One statement per table: Durable Object SQLite rejects large compound queries. `account_merges`
 * rows have no foreign key and stay.
 */
export function deleteUserData(db: SqlDb, userId: number): void {
  db.prepare('DELETE FROM collection_entries WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM value_snapshots WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM users WHERE id = ?').run(userId)
}

/**
 * POST /api/account/delete `{ "confirm": "delete" }`, with a Bearer token or the web session
 * cookie (whose request must come from PUBLIC_URL's origin). Deletes the signed-in user and
 * everything the server keeps for them (deleteUserData), in one transaction, with the accounts
 * merged into it that are still held and the record of those merges.
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
  // Held accounts only: a purged hold's id may now be a new user's (mergedFrom leaves it out).
  const held = mergedFrom(deps.db, userId)
  // Training photos' rows cascade with the users row; their R2 objects are deleted after.
  const photoKey = deps.db.prepare('SELECT r2_key FROM training_photos WHERE user_id = ?')
  const photoKeys = [userId, ...held].flatMap((id) =>
    (photoKey.all(id) as { r2_key: string }[]).map((r) => r.r2_key)
  )
  deps.db.transaction(() => {
    const dropMerge = deps.db.prepare('DELETE FROM account_merges WHERE closed_id = ?')
    for (const id of held) {
      deleteUserData(deps.db, id)
      dropMerge.run(id)
    }
    deleteUserData(deps.db, userId)
  })()
  if (deps.training) {
    // R2 deletes up to 1000 keys a call; one call per batch, in turn.
    let failed = 0
    for (let i = 0; i < photoKeys.length; i += DELETE_BATCH) {
      const batch = photoKeys.slice(i, i + DELETE_BATCH)
      await deps.training.delete(batch).catch(() => (failed += batch.length))
    }
    // The keys are under training/<game>/<user id>/, so a sweep can find what was left.
    if (failed > 0)
      console.warn(
        `${failed} training photo(s) not deleted for deleted account(s) ${[userId, ...held].join(', ')}`
      )
  }
  if (apple) {
    const revoked = await revokeAppleToken(apple.refresh_token, deps).catch(() => false)
    if (!revoked) console.warn('Apple token revoke failed for a deleted account')
  }

  const res = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  res.headers.append('set-cookie', clearSessionCookie())
  return res
}
