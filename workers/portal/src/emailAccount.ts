import type { SqlDb } from '../../../src/main/db/sql'
import { CollectionError } from '../../../src/main/repo/collection'
import type { AddEmailResult, EmailCodeResult } from '../../../src/shared/account'
import {
  EMAIL_COPY,
  emailProblem,
  normalizeEmail,
  passwordProblem
} from '../../../src/shared/emailAuth'
import type { AppDeps } from './app'
import { pruneExpired, randomToken, sha256Hex } from './auth'
import {
  EmailAuthError,
  FLOW_COLUMNS,
  FLOW_TTL_MS,
  attachEmail,
  checkFlowCode,
  issueCode,
  refuse,
  revokeOtherSessions,
  sendCode,
  takeCodeLimits,
  unwrap,
  verifyPasswordLimited,
  type FlowRow,
  type Refusal
} from './emailAuth'
import { changedNotice, emailEnabled } from './emailSend'
import { logServerError } from './errors'
import { beginLink } from './link'
import { hashPassword } from './password'
import { findAccount } from './signIns'

/** What an RPC handler knows about the request beyond the app's deps. */
export interface EmailRpcDeps extends AppDeps {
  userId: number
  /** The caller's address, for the send and wrong-password limits. */
  ip: string
  /** The hash of the caller's session token, which stays signed in when the password changes. */
  sessionHash: string
}

const NO_EMAIL = 'No email sign-in on this account'

/** Every email RPC needs the feature on. */
function requireEnabled(deps: AppDeps): void {
  if (!emailEnabled(deps)) throw new CollectionError('Email sign-in is off')
}

const asString = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new CollectionError(`${what} must be a string`)
  return v
}

const hasEmailSignIn = (db: SqlDb, email: string): boolean =>
  db.prepare("SELECT 1 FROM sign_ins WHERE provider = 'email' AND subject = ?").get(email) !==
  undefined

/** The caller's email sign-in, or a refusal saying they have none. */
function ownEmail(db: SqlDb, userId: number): { subject: string; password_hash: string | null } {
  const row = db
    .prepare("SELECT subject, password_hash FROM sign_ins WHERE user_id = ? AND provider = 'email'")
    .get(userId) as { subject: string; password_hash: string | null } | undefined
  if (!row) throw new CollectionError(NO_EMAIL)
  return row
}

/** Checks the caller's current password under the limits; wrong answers throw wrongPassword. */
async function checkCurrentPassword(
  deps: EmailRpcDeps,
  own: { subject: string; password_hash: string | null },
  password: string
): Promise<void> {
  if (!(await verifyPasswordLimited(deps, own.subject, deps.ip, password, own.password_hash)))
    throw new EmailAuthError(EMAIL_COPY.wrongPassword, 400)
}

/**
 * Starts an `add` or `change` flow for the caller (replacing their earlier one of that kind) and
 * mails the first code. The send limits come first, so a refusal leaves any earlier flow alone.
 */
async function startFlow(
  deps: EmailRpcDeps,
  purpose: 'add' | 'change',
  email: string,
  passwordHash: string | null
): Promise<EmailCodeResult> {
  const { db } = deps
  const ticket = randomToken()
  const ticketHash = await sha256Hex(ticket)
  const now = deps.now()
  const nowIso = now.toISOString()
  const started = db.transaction(() => {
    pruneExpired(deps, nowIso)
    if (!takeCodeLimits(db, email, deps.ip, now)) return false
    db.prepare('DELETE FROM email_flows WHERE user_id = ? AND purpose = ?').run(
      deps.userId,
      purpose
    )
    db.prepare(
      `INSERT INTO email_flows (ticket_hash, purpose, email, user_id, password_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ticketHash,
      purpose,
      email,
      deps.userId,
      passwordHash,
      new Date(now.getTime() + FLOW_TTL_MS).toISOString(),
      nowIso
    )
    return true
  })()
  if (!started) throw new EmailAuthError(EMAIL_COPY.tooManyCodes, 429)
  try {
    await issueCode(deps, { ticketHash, email, purpose }, now)
  } catch (err) {
    db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(ticketHash)
    throw err
  }
  return { status: 'code', ticket }
}

/** `account:addEmail(email, password)`. */
export async function addEmail(
  deps: EmailRpcDeps,
  email: unknown,
  password: unknown
): Promise<AddEmailResult> {
  requireEnabled(deps)
  const { db, userId } = deps
  const address = normalizeEmail(asString(email, 'email'))
  const typed = asString(password, 'password')
  const problem = emailProblem(address)
  if (problem) throw new EmailAuthError(problem, 400)
  const mine = db
    .prepare("SELECT 1 FROM sign_ins WHERE user_id = ? AND provider = 'email'")
    .get(userId)
  if (mine) return { status: 'has-provider', provider: 'email' }

  if (hasEmailSignIn(db, address)) {
    // Another account's email sign-in: its password proves it, then the usual link rules apply.
    const owner = findAccount(db, { provider: 'email', subject: address })
    if (owner === null) throw new EmailAuthError(EMAIL_COPY.emailTaken, 400)
    const stored = (
      db
        .prepare("SELECT password_hash FROM sign_ins WHERE provider = 'email' AND subject = ?")
        .get(address) as { password_hash: string | null }
    ).password_hash
    if (!(await verifyPasswordLimited(deps, address, deps.ip, typed, stored)))
      throw new EmailAuthError(EMAIL_COPY.wrongPassword, 400)
    return beginLink(deps, userId, { provider: 'email', subject: address }, {})
  }

  const passwordIssue = passwordProblem(typed)
  if (passwordIssue) throw new EmailAuthError(passwordIssue, 400)
  return startFlow(deps, 'add', address, await hashPassword(typed))
}

/** A pending add or change flow of this user that can still take a code, or undefined. */
function pendingFlow(db: SqlDb, userId: number, ticketHash: string, nowIso: string) {
  const flow = db
    .prepare(
      `SELECT ${FLOW_COLUMNS} FROM email_flows WHERE ticket_hash = ? AND expires_at > ? AND confirmed = 0 AND purpose IN ('add', 'change')`
    )
    .get(ticketHash, nowIso) as FlowRow | undefined
  return flow && flow.user_id === userId ? flow : undefined
}

/** `account:confirmEmail(ticket, code)`: attaches the added address, or swaps in the changed one. */
export async function confirmEmail(
  deps: EmailRpcDeps,
  ticket: unknown,
  code: unknown
): Promise<{ status: 'linked' }> {
  requireEnabled(deps)
  const { db, userId } = deps
  const ticketHash = await sha256Hex(asString(ticket, 'ticket'))
  const given = await sha256Hex(`${ticketHash}:${asString(code, 'code').trim()}`)
  const nowIso = deps.now().toISOString()
  const out = db.transaction((): { oldEmail: string; newEmail: string } | null | Refusal => {
    pruneExpired(deps, nowIso)
    const flow = pendingFlow(db, userId, ticketHash, nowIso)
    if (!flow) return refuse(EMAIL_COPY.codeExpired)
    const bad = checkFlowCode(db, flow, given, nowIso)
    if (bad) return bad
    db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(ticketHash)
    if (flow.purpose === 'add') {
      const has = db
        .prepare("SELECT 1 FROM sign_ins WHERE user_id = ? AND provider = 'email'")
        .get(userId)
      if (has) return refuse(EMAIL_COPY.alsoHas('email'))
      attachEmail(db, userId, flow.email, flow.password_hash ?? '', nowIso)
      return null
    }
    const own = db
      .prepare("SELECT subject FROM sign_ins WHERE user_id = ? AND provider = 'email'")
      .get(userId) as { subject: string } | undefined
    if (!own) return refuse(NO_EMAIL)
    if (hasEmailSignIn(db, flow.email)) return refuse(EMAIL_COPY.emailTaken)
    db.prepare(
      "UPDATE sign_ins SET subject = ?, email = ? WHERE user_id = ? AND provider = 'email'"
    ).run(flow.email, flow.email, userId)
    return { oldEmail: own.subject, newEmail: flow.email }
  })()
  const changed = unwrap(out)
  if (changed) {
    try {
      await deps.email!.send(changedNotice(changed.oldEmail, changed.newEmail))
    } catch (err) {
      logServerError(
        deps,
        `email change notice failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return { status: 'linked' }
}

/** `account:resendEmailCode(ticket)`. */
export async function resendEmailCode(
  deps: EmailRpcDeps,
  ticket: unknown
): Promise<EmailCodeResult> {
  requireEnabled(deps)
  const text = asString(ticket, 'ticket')
  const ticketHash = await sha256Hex(text)
  const now = deps.now()
  const flow = pendingFlow(deps.db, deps.userId, ticketHash, now.toISOString())
  if (!flow) throw new EmailAuthError(EMAIL_COPY.codeExpired, 400)
  await sendCode(deps, { ticketHash, email: flow.email, purpose: flow.purpose }, deps.ip, now)
  return { status: 'code', ticket: text }
}

/** `account:changePassword(current, next)`: the caller's session stays; every other one ends. */
export async function changePassword(
  deps: EmailRpcDeps,
  current: unknown,
  next: unknown
): Promise<void> {
  requireEnabled(deps)
  const { db, userId } = deps
  const typed = asString(current, 'current')
  const fresh = asString(next, 'next')
  const own = ownEmail(db, userId)
  await checkCurrentPassword(deps, own, typed)
  const problem = passwordProblem(fresh)
  if (problem) throw new EmailAuthError(problem, 400)
  const hash = await hashPassword(fresh)
  db.transaction(() => {
    db.prepare(
      "UPDATE sign_ins SET password_hash = ? WHERE user_id = ? AND provider = 'email'"
    ).run(hash, userId)
    revokeOtherSessions(db, userId, deps.sessionHash)
  })()
}

/** `account:changeEmail(currentPassword, newEmail)`: mails a code to the new address; the old one works until the confirm. */
export async function changeEmail(
  deps: EmailRpcDeps,
  currentPassword: unknown,
  newEmail: unknown
): Promise<EmailCodeResult> {
  requireEnabled(deps)
  const { db, userId } = deps
  const typed = asString(currentPassword, 'currentPassword')
  const address = normalizeEmail(asString(newEmail, 'newEmail'))
  const own = ownEmail(db, userId)
  await checkCurrentPassword(deps, own, typed)
  const problem = emailProblem(address)
  if (problem) throw new EmailAuthError(problem, 400)
  if (hasEmailSignIn(db, address)) throw new EmailAuthError(EMAIL_COPY.emailTaken, 400)
  return startFlow(deps, 'change', address, null)
}
