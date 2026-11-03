import type { SqlDb } from '../../../src/main/db/sql'
import type { AppDeps } from './app'
import { codeAndChallenge, randomToken, sameString, sha256Hex } from './auth'
import type { Provider, SignInProfile } from './signIns'

const CLAIM_TTL_MS = 15 * 60 * 1000

/**
 * A Discord or Apple sign-in with no account yet whose verified email an email account uses
 * (`provider_claims`). It holds the proven identity until the person links it to that account
 * with its password, or makes a separate account. `userId` is the email account.
 */
export interface ClaimRow {
  ticketHash: string
  provider: Exclude<Provider, 'email'>
  subject: string
  profile: SignInProfile
  email: string
  appleRefreshToken: string | null
  userId: number
  challenge: string | null
  kind: 'web' | 'desktop'
}

/** The open account whose email sign-in is this address, or null (also for no address). */
export function claimTarget(db: SqlDb, email: string | null): number | null {
  if (email === null) return null
  const row = db
    .prepare(
      `SELECT s.user_id AS id FROM sign_ins s JOIN users u ON u.id = s.user_id
        WHERE s.provider = 'email' AND s.subject = ? AND u.closed_at IS NULL`
    )
    .get(email) as { id: number } | undefined
  return row?.id ?? null
}

export interface ClaimInput {
  provider: ClaimRow['provider']
  subject: string
  profile: SignInProfile
  email: string
  appleRefreshToken: string | null
  userId: number
  /** The desktop app's PKCE challenge; null when the client has no verifier (Apple). */
  challenge: string | null
  kind: 'web' | 'desktop'
}

/** Stores a claim (replacing an earlier one for the same identity) and returns its raw ticket, good for 15 minutes. */
export async function makeClaim(deps: AppDeps, input: ClaimInput): Promise<string> {
  const ticket = randomToken()
  const ticketHash = await sha256Hex(ticket)
  const now = deps.now()
  deps.db.transaction(() => {
    deps.db
      .prepare('DELETE FROM provider_claims WHERE provider = ? AND subject = ?')
      .run(input.provider, input.subject)
    deps.db
      .prepare(
        `INSERT INTO provider_claims (ticket_hash, provider, subject, profile, email,
           apple_refresh_token, user_id, challenge, kind, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ticketHash,
        input.provider,
        input.subject,
        JSON.stringify(input.profile),
        input.email,
        input.appleRefreshToken,
        input.userId,
        input.challenge,
        input.kind,
        new Date(now.getTime() + CLAIM_TTL_MS).toISOString()
      )
  })()
  return ticket
}

/** What a ticket and PKCE verifier look like to the database; made once, then used inside a transaction. */
export interface ClaimKey {
  ticketHash: string
  /** The challenge the verifier makes, or null when it isn't a verifier. */
  challenge: string | null
}

export async function claimKey(ticket: unknown, verifier: unknown): Promise<ClaimKey | null> {
  const checked = await codeAndChallenge(ticket, verifier)
  return checked && { ticketHash: checked.codeHash, challenge: checked.challenge }
}

/**
 * The live claim this ticket names, or null: unknown, expired, the other kind, or (when the claim
 * holds a PKCE challenge) a verifier that doesn't match. Leaves the row alone, so a wrong
 * password can retry; `spendClaim` deletes it once the claim is used.
 */
export function peekClaim(
  db: SqlDb,
  key: ClaimKey,
  kind: ClaimRow['kind'],
  nowIso: string
): ClaimRow | null {
  const row = db
    .prepare(
      `SELECT ticket_hash, provider, subject, profile, email, apple_refresh_token, user_id,
              challenge, kind FROM provider_claims WHERE ticket_hash = ? AND expires_at > ?`
    )
    .get(key.ticketHash, nowIso) as
    | {
        ticket_hash: string
        provider: ClaimRow['provider']
        subject: string
        profile: string
        email: string
        apple_refresh_token: string | null
        user_id: number
        challenge: string | null
        kind: ClaimRow['kind']
      }
    | undefined
  if (!row || row.kind !== kind) return null
  if (
    row.challenge !== null &&
    (key.challenge === null || !sameString(key.challenge, row.challenge))
  )
    return null
  return {
    ticketHash: row.ticket_hash,
    provider: row.provider,
    subject: row.subject,
    profile: JSON.parse(row.profile) as SignInProfile,
    email: row.email,
    appleRefreshToken: row.apple_refresh_token,
    userId: row.user_id,
    challenge: row.challenge,
    kind: row.kind
  }
}

/** `peekClaim` for a raw ticket and verifier. */
export async function takeClaim(
  db: SqlDb,
  ticket: unknown,
  verifier: unknown,
  kind: ClaimRow['kind'],
  nowIso: string
): Promise<ClaimRow | null> {
  const key = await claimKey(ticket, verifier)
  return key && peekClaim(db, key, kind, nowIso)
}

export function spendClaim(db: SqlDb, ticketHash: string): void {
  db.prepare('DELETE FROM provider_claims WHERE ticket_hash = ?').run(ticketHash)
}

/** Keeps the Apple refresh token a claim carried, so deleting the account can revoke it. Call inside a transaction. */
export function keepAppleToken(db: SqlDb, claim: ClaimRow, userId: number, nowIso: string): void {
  if (claim.provider !== 'apple' || !claim.appleRefreshToken) return
  db.prepare(
    `INSERT INTO apple_tokens (user_id, refresh_token, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET refresh_token = excluded.refresh_token,
       updated_at = excluded.updated_at`
  ).run(userId, claim.appleRefreshToken, nowIso)
}
