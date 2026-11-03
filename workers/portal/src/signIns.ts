import type { SqlDb } from '../../../src/main/db/sql'
import { USERNAME_RE, type SignInProvider } from '../../../src/shared/account'

/**
 * Sign-in methods (server-30's `sign_ins`): each account has at most one per provider, and each
 * provider's subject (Discord's user id, Apple's `sub`) belongs to one account. A sign-in never
 * renames an account: its username is the user's to choose.
 */
export type Provider = SignInProvider

export interface Identity {
  provider: Provider
  subject: string
}

export interface DiscordProfile {
  username: string
  displayName: string | null
  avatar: string | null
}

/** What a sign-in brings: Discord sends a username and avatar, Apple at most a name. */
export interface SignInProfile {
  username?: string
  displayName: string | null
  avatar: string | null
}

const USERNAME_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

export function isValidUsername(name: string): boolean {
  return USERNAME_RE.test(name)
}

const usernameTaken = (db: SqlDb, name: string): boolean =>
  db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name) !== undefined

/** A free `duelist-` and eight random letters username. */
export function generatedUsername(db: SqlDb): string {
  for (;;) {
    const letters = [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => USERNAME_ALPHABET[b % USERNAME_ALPHABET.length])
      .join('')
    const name = `duelist-${letters}`
    if (!usernameTaken(db, name)) return name
  }
}

/** The open account this sign-in belongs to, or null. */
export function findAccount(db: SqlDb, id: Identity): number | null {
  const row = db
    .prepare(
      `SELECT s.user_id AS id FROM sign_ins s JOIN users u ON u.id = s.user_id
        WHERE s.provider = ? AND s.subject = ? AND u.closed_at IS NULL`
    )
    .get(id.provider, id.subject) as { id: number } | undefined
  return row?.id ?? null
}

/**
 * Keeps `users.discord_id`, which old code and the avatar URL still read, in step with the
 * sign-ins: the Discord id if the account has one, else `apple:` and Apple's id, else `user:` and
 * the account id (all unique: Discord ids are digits only).
 */
export function refreshLegacyDiscordId(db: SqlDb, userId: number): void {
  const rows = db
    .prepare('SELECT provider, subject FROM sign_ins WHERE user_id = ?')
    .all(userId) as { provider: string; subject: string }[]
  const discord = rows.find((r) => r.provider === 'discord')
  const apple = rows.find((r) => r.provider === 'apple')
  const legacy = discord ? discord.subject : apple ? `apple:${apple.subject}` : `user:${userId}`
  db.prepare('UPDATE users SET discord_id = ? WHERE id = ? AND discord_id <> ?').run(
    legacy,
    userId,
    legacy
  )
}

/**
 * A new account for this sign-in. It keeps the offered username when valid and free, else gets a
 * generated one; either way the name counts as not chosen yet. Call inside a transaction.
 */
export function createAccount(
  db: SqlDb,
  id: Identity,
  profile: SignInProfile,
  nowIso: string
): number {
  const offered = profile.username
  const username =
    offered !== undefined && isValidUsername(offered) && !usernameTaken(db, offered)
      ? offered
      : generatedUsername(db)
  const legacy = id.provider === 'discord' ? id.subject : `${id.provider}:${id.subject}`
  const userId = Number(
    db
      .prepare(
        `INSERT INTO users (discord_id, username, display_name, avatar, created_at, updated_at,
           username_chosen, link_hint)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1)`
      )
      .run(legacy, username, profile.displayName, profile.avatar, nowIso, nowIso).lastInsertRowid
  )
  db.prepare(
    'INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(id.provider, id.subject, userId, nowIso)
  refreshLegacyDiscordId(db, userId)
  return userId
}

/**
 * Signs in with this identity, making its account on first use. A Discord sign-in refreshes the
 * display name and avatar; an Apple one only fills an empty display name. Neither touches the
 * username. Call inside a transaction.
 */
export function signInWith(
  db: SqlDb,
  id: Identity,
  profile: SignInProfile,
  nowIso: string
): { userId: number; created: boolean } {
  const userId = findAccount(db, id)
  if (userId === null) return { userId: createAccount(db, id, profile, nowIso), created: true }
  if (id.provider === 'discord') {
    db.prepare('UPDATE users SET display_name = ?, avatar = ?, updated_at = ? WHERE id = ?').run(
      profile.displayName,
      profile.avatar,
      nowIso,
      userId
    )
  } else {
    db.prepare(
      'UPDATE users SET display_name = COALESCE(display_name, ?), updated_at = ? WHERE id = ?'
    ).run(profile.displayName, nowIso, userId)
  }
  return { userId, created: false }
}
