import { CollectionError } from '../../../src/main/repo/collection'
import type {
  AccountSummary,
  CardChoice,
  LinkResult,
  MergePreview,
  SignInProvider
} from '../../../src/shared/account'
import type { AppDeps } from './app'
import { takeDailyAllowance } from './accountRpc'
import {
  avatarUrl,
  codeAndChallenge,
  pruneExpired,
  randomToken,
  sameString,
  sha256Hex,
  verifyAppleSignIn
} from './auth'
import { cardTotal, planCardMerge } from './mergePlan'
import { findAccount, refreshLegacyDiscordId, type DiscordProfile, type Identity } from './signIns'

/** How long the merge screen has to confirm a merge. */
const MERGE_TICKET_TTL_MS = 15 * 60 * 1000
const CHOICES: readonly CardChoice[] = ['higher', 'mine', 'theirs', 'sum']

type Db = AppDeps['db']

const providersOf = (db: Db, userId: number): string[] =>
  (
    db.prepare('SELECT provider FROM sign_ins WHERE user_id = ?').all(userId) as {
      provider: string
    }[]
  ).map((r) => r.provider)

const countOf = (db: Db, sql: string, userId: number): number =>
  (db.prepare(sql).get(userId) as { n: number }).n

/** The merge screen's view of one account: who it is, and how much it holds across all games. */
function accountSummary(db: Db, userId: number): AccountSummary {
  const user = db
    .prepare(
      'SELECT discord_id, username, username_chosen, display_name, avatar FROM users WHERE id = ?'
    )
    .get(userId) as {
    discord_id: string
    username: string
    username_chosen: number
    display_name: string | null
    avatar: string | null
  }
  return {
    username: user.username,
    usernameChosen: user.username_chosen === 1,
    displayName: user.display_name,
    avatarUrl: avatarUrl(user.discord_id, user.avatar),
    cards: countOf(
      db,
      'SELECT COALESCE(SUM(quantity), 0) AS n FROM collection_entries WHERE user_id = ? AND deleted_at IS NULL',
      userId
    ),
    binders: countOf(
      db,
      'SELECT count(*) AS n FROM binders WHERE user_id = ? AND deleted_at IS NULL',
      userId
    ),
    wishes: countOf(
      db,
      'SELECT count(*) AS n FROM wishlist_entries WHERE user_id = ? AND deleted_at IS NULL',
      userId
    )
  }
}

function mergePreview(db: Db, userId: number, otherId: number): MergePreview {
  const totals = Object.fromEntries(
    CHOICES.map((c) => [c, cardTotal(db, userId, planCardMerge(db, userId, otherId, c))])
  ) as Record<CardChoice, number>
  return { mine: accountSummary(db, userId), theirs: accountSummary(db, otherId), totals }
}

/**
 * Links a verified sign-in to `userId`'s account:
 * - nobody has it → it's attached (`linked`); a Discord one fills an empty display name and
 *   picture, an Apple one keeps its refresh token;
 * - it's already this account's → `already`;
 * - this account has that provider, or its owner shares a provider with this account (the merged
 *   account would have two) → `has-provider`;
 * - otherwise → a 15-minute merge ticket and the merge screen's preview (`merge`).
 * Linking and merge tickets count against the day's 10 link attempts. Nothing is merged here.
 * Async only to make the ticket; the checks and writes run in one transaction.
 */
export async function beginLink(
  deps: AppDeps,
  userId: number,
  id: Identity,
  extra: { profile?: DiscordProfile; email?: string | null; appleRefreshToken?: string | null }
): Promise<LinkResult> {
  const { db } = deps
  const ticket = randomToken()
  const ticketHash = await sha256Hex(ticket)
  const now = deps.now()
  const nowIso = now.toISOString()
  const appleToken = id.provider === 'apple' ? (extra.appleRefreshToken ?? null) : null
  return db.transaction((): LinkResult => {
    pruneExpired(deps, nowIso)
    const owner = findAccount(db, id)
    if (owner === userId) return { status: 'already' }
    const mine = providersOf(db, userId)
    if (mine.includes(id.provider)) return { status: 'has-provider', provider: id.provider }
    if (owner === null) {
      // findAccount skips closed accounts; a held account's sign-in can't be taken.
      if (
        db
          .prepare('SELECT 1 FROM sign_ins WHERE provider = ? AND subject = ?')
          .get(id.provider, id.subject)
      )
        throw new CollectionError('This sign-in belongs to a closed account')
    } else {
      const shared = providersOf(db, owner).find((p) => mine.includes(p))
      if (shared) return { status: 'has-provider', provider: shared as SignInProvider }
    }
    if (!takeDailyAllowance(db, userId, 'link', now))
      throw new CollectionError("You've linked sign-ins too often today. Try again tomorrow.")

    if (owner !== null) {
      db.prepare(
        `INSERT INTO merge_tickets (ticket_hash, user_id, other_id, provider, subject,
           apple_refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        ticketHash,
        userId,
        owner,
        id.provider,
        id.subject,
        appleToken,
        new Date(now.getTime() + MERGE_TICKET_TTL_MS).toISOString()
      )
      return { status: 'merge', ticket, preview: mergePreview(db, userId, owner) }
    }

    db.prepare(
      'INSERT INTO sign_ins (provider, subject, user_id, created_at, email) VALUES (?, ?, ?, ?, ?)'
    ).run(id.provider, id.subject, userId, nowIso, extra.email ?? null)
    refreshLegacyDiscordId(db, userId)
    const profile = id.provider === 'discord' ? extra.profile : undefined
    db.prepare(
      `UPDATE users SET display_name = COALESCE(display_name, ?), avatar = COALESCE(avatar, ?),
         updated_at = ? WHERE id = ?`
    ).run(profile?.displayName ?? null, profile?.avatar ?? null, nowIso, userId)
    if (appleToken)
      db.prepare(
        `INSERT INTO apple_tokens (user_id, refresh_token, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET refresh_token = excluded.refresh_token,
           updated_at = excluded.updated_at`
      ).run(userId, appleToken, nowIso)
    return { status: 'linked' }
  })()
}

/**
 * Spends a `/auth/desktop/start?intent=link` code: like the desktop token exchange, the verifier
 * must match the flow's PKCE challenge and the code is spent whatever happens. Null when the code
 * is unknown, expired or not a Discord one, or the verifier is wrong.
 */
export async function takeLinkCode(
  deps: AppDeps,
  code: unknown,
  verifier: unknown
): Promise<{ subject: string; profile: DiscordProfile } | null> {
  const checked = await codeAndChallenge(code, verifier)
  if (!checked) return null
  const { codeHash, challenge } = checked
  const nowIso = deps.now().toISOString()
  const row = deps.db.transaction(() => {
    pruneExpired(deps, nowIso)
    const found = deps.db
      .prepare(
        'SELECT challenge, provider, subject, profile, expires_at FROM link_codes WHERE code_hash = ?'
      )
      .get(codeHash) as
      | {
          challenge: string
          provider: string
          subject: string
          profile: string
          expires_at: string
        }
      | undefined
    deps.db.prepare('DELETE FROM link_codes WHERE code_hash = ?').run(codeHash)
    if (
      !found ||
      found.expires_at <= nowIso ||
      challenge === null ||
      !sameString(challenge, found.challenge) ||
      found.provider !== 'discord'
    )
      return null
    return found
  })()
  return row ? { subject: row.subject, profile: JSON.parse(row.profile) as DiscordProfile } : null
}

/**
 * `account:linkCode(code, verifier)`: links the Discord account a `/auth/desktop/start?intent=link`
 * flow handed back as `code` (see `takeLinkCode`).
 */
export async function linkCode(
  deps: AppDeps,
  userId: number,
  code: unknown,
  verifier: unknown
): Promise<LinkResult> {
  const taken = await takeLinkCode(deps, code, verifier)
  if (!taken) throw new CollectionError('invalid-code')
  return beginLink(
    deps,
    userId,
    { provider: 'discord', subject: taken.subject },
    { profile: taken.profile, email: taken.profile.email ?? null }
  )
}

/**
 * `account:linkApple({ identityToken, nonce, authorizationCode? })`: links the iPhone app's Sign
 * in with Apple, checked as `/auth/apple/token` checks it. A refresh token is kept with the
 * sign-in, or on the merge ticket until the merge.
 */
export async function linkApple(
  deps: AppDeps,
  userId: number,
  input: unknown
): Promise<LinkResult> {
  const verified = await verifyAppleSignIn(input, deps)
  if (!verified) throw new CollectionError('invalid-token')
  return beginLink(
    deps,
    userId,
    { provider: 'apple', subject: verified.sub },
    { email: verified.email, appleRefreshToken: verified.refreshToken }
  )
}
