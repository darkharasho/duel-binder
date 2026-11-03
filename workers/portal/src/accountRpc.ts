import type { SqlDb } from '../../../src/main/db/sql'
import { CollectionError } from '../../../src/main/repo/collection'
import type { Me } from '../../../src/shared/cloud'
import {
  LAST_SIGN_IN,
  usernameProblem,
  type SignInMethod,
  type SignInProvider
} from '../../../src/shared/account'
import type { AppDeps } from './app'
import { revokeAppleToken } from './apple'
import { loadMe } from './auth'
import { refreshLegacyDiscordId } from './signIns'

/** Account changes limited per rolling day (server-31's `account_change_log`). */
export type AccountChangeKind = 'username' | 'link'

export const DAILY_ACCOUNT_CHANGES: Record<AccountChangeKind, number> = { username: 5, link: 10 }

const DAY_MS = 24 * 60 * 60 * 1000
const PROVIDERS: readonly SignInProvider[] = ['discord', 'apple', 'email']

/**
 * Counts one `kind` change for this user against its daily limit (the rolling 24 hours of
 * friends.ts's friend requests). Records it and returns true while under the limit; returns false,
 * recording nothing, once the limit is reached. The caller throws its own message. Call it after
 * the change has passed every other check, inside the change's transaction.
 */
export function takeDailyAllowance(
  db: SqlDb,
  userId: number,
  kind: AccountChangeKind,
  now: Date
): boolean {
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  db.prepare(
    'DELETE FROM account_change_log WHERE user_id = ? AND kind = ? AND created_at <= ?'
  ).run(userId, kind, since)
  const { n } = db
    .prepare('SELECT count(*) AS n FROM account_change_log WHERE user_id = ? AND kind = ?')
    .get(userId, kind) as { n: number }
  if (n >= DAILY_ACCOUNT_CHANGES[kind]) return false
  db.prepare('INSERT INTO account_change_log (user_id, kind, created_at) VALUES (?, ?, ?)').run(
    userId,
    kind,
    now.toISOString()
  )
  return true
}

/** The account's sign-in methods, oldest first. */
export function listSignIns(db: SqlDb, userId: number): SignInMethod[] {
  return (
    db
      .prepare(
        'SELECT provider, subject, created_at FROM sign_ins WHERE user_id = ? ORDER BY created_at, rowid'
      )
      .all(userId) as { provider: SignInProvider; subject: string; created_at: string }[]
  ).map((r) => ({
    provider: r.provider,
    addedAt: r.created_at,
    ...(r.provider === 'email' ? { email: r.subject } : {})
  }))
}

/**
 * Sets the username, which then counts as chosen. Refused when it breaks the rules, belongs to
 * someone else in any case, or this is the day's sixth change. Re-saving the same name only marks
 * it chosen and isn't counted.
 */
export function setUsername(deps: AppDeps, userId: number, name: unknown): Me {
  if (typeof name !== 'string') throw new CollectionError('username must be a string')
  const problem = usernameProblem(name)
  if (problem) throw new CollectionError(problem)
  const { db } = deps
  const now = deps.now()
  db.transaction(() => {
    const taken = db
      .prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id <> ?')
      .get(name, userId)
    if (taken) throw new CollectionError('That username is taken')
    const current = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as {
      username: string
    }
    if (current.username !== name && !takeDailyAllowance(db, userId, 'username', now))
      throw new CollectionError("You've changed your username too often today. Try again tomorrow.")
    db.prepare(
      'UPDATE users SET username = ?, username_chosen = 1, updated_at = ? WHERE id = ?'
    ).run(name, now.toISOString(), userId)
  })()
  return loadMe(deps, userId)
}

/**
 * Removes one sign-in method, never the account's last. Removing Apple drops its refresh token and
 * then revokes it with Apple; the sign-in is gone either way, so a failed revoke is only logged.
 * Removing a method the account doesn't have does nothing.
 */
export async function removeSignIn(
  deps: AppDeps,
  userId: number,
  provider: unknown
): Promise<void> {
  if (!PROVIDERS.includes(provider as SignInProvider))
    throw new CollectionError('provider must be discord, apple or email')
  const { db } = deps
  const apple =
    provider === 'apple'
      ? (db.prepare('SELECT refresh_token FROM apple_tokens WHERE user_id = ?').get(userId) as
          { refresh_token: string } | undefined)
      : undefined
  const removed = db.transaction((): boolean => {
    const providers = (
      db.prepare('SELECT provider FROM sign_ins WHERE user_id = ?').all(userId) as {
        provider: string
      }[]
    ).map((r) => r.provider)
    if (!providers.includes(provider as string)) return false
    if (providers.length <= 1)
      throw new CollectionError(LAST_SIGN_IN)
    db.prepare('DELETE FROM sign_ins WHERE user_id = ? AND provider = ?').run(userId, provider)
    if (provider === 'apple') db.prepare('DELETE FROM apple_tokens WHERE user_id = ?').run(userId)
    // Pending add, change and reset flows would otherwise outlive the sign-in they belong to.
    if (provider === 'email') db.prepare('DELETE FROM email_flows WHERE user_id = ?').run(userId)
    refreshLegacyDiscordId(db, userId)
    return true
  })()
  if (removed && apple) {
    const revoked = await revokeAppleToken(apple.refresh_token, deps).catch(() => false)
    if (!revoked) console.warn('Apple token revoke failed for a removed sign-in')
  }
}

/** Turns off the suggestion to link another sign-in. */
export function dismissLinkHint(deps: AppDeps, userId: number): Me {
  deps.db
    .prepare('UPDATE users SET link_hint = 0, updated_at = ? WHERE id = ?')
    .run(deps.now().toISOString(), userId)
  return loadMe(deps, userId)
}
