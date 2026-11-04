import type { SqlDb } from '../../../src/main/db/sql'
import {
  CODE_LENGTH,
  EMAIL_COPY,
  MAX_EMAIL_LEN,
  MAX_PASSWORD,
  emailProblem,
  normalizeEmail,
  passwordProblem,
  type EmailAuthReply,
  type EmailStep
} from '../../../src/shared/emailAuth'
import type { AppDeps } from './app'
import {
  isJson,
  loadMe,
  mintSession,
  pruneExpired,
  randomToken,
  sameString,
  sha256Hex,
  verifyAppleSignIn
} from './auth'
import { clientIp, forgetAttempt, isLimited, recordAttempt, takeLimit } from './authLimits'
import { codeMessage, emailEnabled } from './emailSend'
import { logServerError } from './errors'
import { hashPassword, verifyPassword } from './password'
import { takeLinkCode } from './link'
import { bindTesterInvites } from './testers'
import { claimKey, keepAppleToken, peekClaim, spendClaim, type ClaimRow } from './emailClaim'
import {
  createAccount,
  findAccount,
  refreshLegacyDiscordId,
  signInWith,
  type Identity
} from './signIns'

const MINUTE_MS = 60 * 1000
const CODE_TTL_MS = 15 * MINUTE_MS
export const FLOW_TTL_MS = 24 * 60 * MINUTE_MS
const CONFIRMED_TTL_MS = 15 * MINUTE_MS
const MAX_TRIES = 5

/** The result of a step: a reply the client shows, or an account to sign in (the route mints the session). */
export type StepOutcome =
  | Exclude<EmailAuthReply, { next: 'signed-in' }>
  | { next: 'signed-in'; userId: number; created: boolean }

/** A refusal whose message is copy for the user. */
export class EmailAuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 429,
    /** Stable reason, for callers that must not match on the copy. */
    readonly code: 'expired' | 'other-account' | 'also-has' | 'refused' = 'refused'
  ) {
    super(message)
  }
}

export type Flow = {
  ticketHash: string
  email: string
  purpose: 'signup' | 'reset' | 'add' | 'change'
}

export interface FlowRow {
  ticket_hash: string
  purpose: 'signup' | 'reset' | 'add' | 'change'
  email: string
  user_id: number | null
  password_hash: string | null
  code_hash: string | null
  code_expires_at: string | null
  tries: number
  confirmed: number
}

/** A refusal found inside a transaction; thrown after commit so the step's other writes (a try count) stay. */
export type Refusal = { refuse: EmailAuthError }
export const refuse = (
  message: string,
  status: 400 | 404 | 429 = 400,
  code?: EmailAuthError['code']
): Refusal => ({
  refuse: new EmailAuthError(message, status, code)
})
export const unwrap = <T>(r: T | Refusal): T => {
  if (r !== null && typeof r === 'object' && 'refuse' in r) throw (r as Refusal).refuse
  return r as T
}

export const FLOW_COLUMNS =
  'ticket_hash, purpose, email, user_id, password_hash, code_hash, code_expires_at, tries, confirmed'

const text = (body: Record<string, unknown>, key: string): string => {
  const v = body[key]
  return typeof v === 'string' ? v : ''
}

/** A 6-digit code, uniform over 000000 to 999999 (values that would bias the modulo are redrawn). */
function newCode(): string {
  const range = 10 ** CODE_LENGTH
  const limit = Math.floor(2 ** 32 / range) * range
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return String(buf[0] % range).padStart(CODE_LENGTH, '0')
  }
}

const hasEmailSignIn = (db: SqlDb, email: string): boolean =>
  db.prepare("SELECT 1 FROM sign_ins WHERE provider = 'email' AND subject = ?").get(email) !==
  undefined

/** Deletes the account's sessions (all, or all but `keepTokenHash`) and its pending merge, sign-up and claim tickets. */
export function revokeOtherSessions(db: SqlDb, userId: number, keepTokenHash: string | null): void {
  if (keepTokenHash === null) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  else
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(
      userId,
      keepTokenHash
    )
  db.prepare('DELETE FROM merge_tickets WHERE user_id = ? OR other_id = ?').run(userId, userId)
  db.prepare('DELETE FROM email_flows WHERE user_id = ?').run(userId)
  db.prepare('DELETE FROM provider_claims WHERE user_id = ?').run(userId)
}

/** Adds an email sign-in to the account. Call inside a transaction. */
export function attachEmail(
  db: SqlDb,
  userId: number,
  email: string,
  passwordHash: string,
  nowIso: string
): void {
  if (hasEmailSignIn(db, email)) throw new EmailAuthError(EMAIL_COPY.emailTaken, 400)
  db.prepare(
    `INSERT INTO sign_ins (provider, subject, user_id, created_at, email, password_hash)
     VALUES ('email', ?, ?, ?, ?, ?)`
  ).run(email, userId, nowIso, email, passwordHash)
  refreshLegacyDiscordId(db, userId)
}

/** Checks the three code limits and, when all are clear, records a send against each. False means refused. */
export function takeCodeLimits(db: SqlDb, email: string, ip: string, now: Date): boolean {
  const kinds = [
    ['code-email-min', email],
    ['code-email-hour', email],
    ['code-ip', ip]
  ] as const
  if (kinds.some(([kind, key]) => isLimited(db, kind, key, now))) return false
  for (const [kind, key] of kinds) recordAttempt(db, kind, key, now)
  return true
}

/**
 * Stores a fresh code on the flow (resetting the tries) and mails it. A flow that is gone
 * answers `codeExpired` and sends nothing. Does not touch the limits.
 */
export async function issueCode(deps: AppDeps, flow: Flow, now: Date): Promise<void> {
  const code = newCode()
  const codeHash = await sha256Hex(`${flow.ticketHash}:${code}`)
  const { changes } = deps.db
    .prepare(
      'UPDATE email_flows SET code_hash = ?, code_expires_at = ?, tries = 0 WHERE ticket_hash = ?'
    )
    .run(codeHash, new Date(now.getTime() + CODE_TTL_MS).toISOString(), flow.ticketHash)
  if (changes === 0) throw new EmailAuthError(EMAIL_COPY.codeExpired, 400)
  try {
    await deps.email!.send(codeMessage(flow.email, code, flow.purpose))
  } catch (err) {
    logServerError(
      deps,
      `email code send failed: ${err instanceof Error ? err.message : String(err)}`
    )
    throw new EmailAuthError(EMAIL_COPY.sendFailed, 400)
  }
}

/**
 * Makes a fresh code for an existing flow and mails it. The three send limits apply first (a
 * refusal changes nothing); a new code replaces the old one and resets the tries.
 */
export async function sendCode(deps: AppDeps, flow: Flow, ip: string, now: Date): Promise<void> {
  if (!takeCodeLimits(deps.db, flow.email, ip, now))
    throw new EmailAuthError(EMAIL_COPY.tooManyCodes, 429)
  await issueCode(deps, flow, now)
}

/**
 * Checks `password` against a stored hash under the wrong-password limits (per email and per IP).
 * Both attempts are checked and recorded before the first await, so parallel guesses can't all
 * pass the cap; a right password takes them back. Over the limit it throws; a wrong password is false.
 */
export async function verifyPasswordLimited(
  deps: AppDeps,
  email: string,
  ip: string,
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  const { db } = deps
  const now = deps.now()
  const key = email.slice(0, MAX_EMAIL_LEN)
  if (isLimited(db, 'password-email', key, now) || isLimited(db, 'password-ip', ip, now))
    throw new EmailAuthError(EMAIL_COPY.tooManyTries, 429)
  const attempts = [
    recordAttempt(db, 'password-email', key, now),
    recordAttempt(db, 'password-ip', ip, now)
  ]
  if (!storedHash || password.length > MAX_PASSWORD) return false
  if (!(await verifyPassword(password, storedHash))) return false
  for (const id of attempts) forgetAttempt(db, id)
  return true
}

/**
 * Judges a typed code against a pending flow, inside the caller's transaction: null when it is
 * the flow's newest, unexpired code; otherwise the refusal, after counting the wrong try (the
 * fifth kills the code). `given` is `sha256Hex(ticketHash + ':' + code)`.
 */
export function checkFlowCode(
  db: SqlDb,
  flow: FlowRow,
  given: string,
  nowIso: string
): Refusal | null {
  if (!flow.code_hash || !flow.code_expires_at || flow.code_expires_at <= nowIso)
    return refuse(EMAIL_COPY.codeExpired)
  if (sameString(given, flow.code_hash)) return null
  const tries = flow.tries + 1
  if (tries >= MAX_TRIES) {
    db.prepare(
      'UPDATE email_flows SET code_hash = NULL, code_expires_at = NULL, tries = ? WHERE ticket_hash = ?'
    ).run(tries, flow.ticket_hash)
    return refuse(EMAIL_COPY.codeExpired)
  }
  db.prepare('UPDATE email_flows SET tries = ? WHERE ticket_hash = ?').run(tries, flow.ticket_hash)
  return refuse(EMAIL_COPY.codeWrong)
}

async function checkStep(
  deps: AppDeps,
  body: Record<string, unknown>,
  ip: string
): Promise<StepOutcome> {
  const { db } = deps
  const email = normalizeEmail(text(body, 'email'))
  const problem = emailProblem(email)
  if (problem) throw new EmailAuthError(problem, 400)
  if (!takeLimit(db, 'check-ip', ip, deps.now()))
    throw new EmailAuthError(EMAIL_COPY.tooManyTries, 429)
  return { next: hasEmailSignIn(db, email) ? 'password' : 'create', email }
}

async function passwordStep(
  deps: AppDeps,
  body: Record<string, unknown>,
  ip: string
): Promise<StepOutcome> {
  const { db } = deps
  const email = normalizeEmail(text(body, 'email'))
  const password = text(body, 'password')
  const row =
    emailProblem(email) === null
      ? (db
          .prepare(
            "SELECT user_id, password_hash FROM sign_ins WHERE provider = 'email' AND subject = ?"
          )
          .get(email) as { user_id: number; password_hash: string | null } | undefined)
      : undefined
  const userId = row?.password_hash ? findAccount(db, { provider: 'email', subject: email }) : null
  if (
    await verifyPasswordLimited(
      deps,
      email,
      ip,
      password,
      userId === null ? null : row?.password_hash
    )
  ) {
    return { next: 'signed-in', userId: userId as number, created: false }
  }
  throw new EmailAuthError(EMAIL_COPY.wrongPassword, 400)
}

async function createStep(
  deps: AppDeps,
  body: Record<string, unknown>,
  ip: string
): Promise<StepOutcome> {
  const { db } = deps
  const email = normalizeEmail(text(body, 'email'))
  const password = text(body, 'password')
  const problem = emailProblem(email) ?? passwordProblem(password)
  if (problem) throw new EmailAuthError(problem, 400)
  if (hasEmailSignIn(db, email)) throw new EmailAuthError(EMAIL_COPY.emailTaken, 400)
  const now = deps.now()
  const nowIso = now.toISOString()
  // Limits first, before the costly hash: a refused request must do no work and leave the
  // pending sign-up and its code alone.
  if (!takeCodeLimits(db, email, ip, now)) throw new EmailAuthError(EMAIL_COPY.tooManyCodes, 429)
  const passwordHash = await hashPassword(password)
  const ticket = randomToken()
  const ticketHash = await sha256Hex(ticket)
  db.transaction(() => {
    pruneExpired(deps, nowIso)
    db.prepare("DELETE FROM email_flows WHERE purpose = 'signup' AND email = ?").run(email)
    db.prepare(
      `INSERT INTO email_flows (ticket_hash, purpose, email, password_hash, expires_at, created_at)
       VALUES (?, 'signup', ?, ?, ?, ?)`
    ).run(
      ticketHash,
      email,
      passwordHash,
      new Date(now.getTime() + FLOW_TTL_MS).toISOString(),
      nowIso
    )
  })()
  try {
    await issueCode(deps, { ticketHash, email, purpose: 'signup' }, now)
  } catch (err) {
    db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(ticketHash)
    throw err
  }
  return { next: 'code', ticket, email, purpose: 'signup' }
}

/** Makes the email account a confirmed sign-up asked for and spends the flow. Call inside a transaction. */
function createFromFlow(db: SqlDb, flow: FlowRow, nowIso: string): number {
  if (hasEmailSignIn(db, flow.email)) throw new EmailAuthError(EMAIL_COPY.emailTaken, 400)
  const userId = createAccount(
    db,
    { provider: 'email', subject: flow.email },
    { displayName: null, avatar: null },
    nowIso
  )
  db.prepare(
    "UPDATE sign_ins SET email = ?, password_hash = ? WHERE provider = 'email' AND subject = ?"
  ).run(flow.email, flow.password_hash, flow.email)
  db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(flow.ticket_hash)
  return userId
}

/**
 * The open accounts whose Discord or Apple sign-in vouched for this email, oldest first. Open
 * means not closed (which a merge also does to the account it folds away).
 */
function accountsUsingEmail(db: SqlDb, email: string): number[] {
  const rows = db
    .prepare(
      `SELECT s.user_id AS id FROM sign_ins s JOIN users u ON u.id = s.user_id
        WHERE s.email = ? AND s.provider IN ('discord', 'apple') AND u.closed_at IS NULL
        ORDER BY u.created_at, u.id`
    )
    .all(email) as { id: number }[]
  return [...new Set(rows.map((r) => r.id))]
}

const hasEmailOn = (db: SqlDb, userId: number): boolean =>
  db.prepare("SELECT 1 FROM sign_ins WHERE user_id = ? AND provider = 'email'").get(userId) !==
  undefined

/** The account a sign-up for this email is offered: the oldest user of it without an email sign-in. */
export function matchedAccount(
  db: SqlDb,
  email: string
): { userId: number; providers: ('discord' | 'apple')[] } | null {
  const userId = accountsUsingEmail(db, email).find((id) => !hasEmailOn(db, id))
  if (userId === undefined) return null
  const rows = db
    .prepare("SELECT provider FROM sign_ins WHERE user_id = ? AND provider IN ('discord', 'apple')")
    .all(userId) as { provider: 'discord' | 'apple' }[]
  return { userId, providers: rows.map((r) => r.provider).sort() }
}

/** A confirmed, unexpired sign-up flow, or undefined. */
export function confirmedSignup(db: SqlDb, ticketHash: string, nowIso: string): FlowRow | undefined {
  return db
    .prepare(
      `SELECT ${FLOW_COLUMNS} FROM email_flows WHERE ticket_hash = ? AND purpose = 'signup' AND confirmed = 1 AND expires_at > ?`
    )
    .get(ticketHash, nowIso) as FlowRow | undefined
}

/**
 * Proves the offered account with the provider sign-in `id` and attaches the flow's email to it
 * (with the flow's password), spending the flow. The identity must belong to the matched account;
 * anything else is refused with the flow intact, so `separate` still works. Returns the account.
 */
export async function attachFromFlow(
  deps: AppDeps,
  ticket: string,
  id: Identity,
  nowIso: string,
  /** Runs inside the same transaction once the email is attached (a throw undoes the attach). */
  inTransaction?: (userId: number) => void
): Promise<number> {
  const { db } = deps
  const ticketHash = await sha256Hex(ticket)
  const out = db.transaction((): number | Refusal => {
    const flow = confirmedSignup(db, ticketHash, nowIso)
    if (!flow) return refuse(EMAIL_COPY.codeExpired, 400, 'expired')
    const userId = findAccount(db, id)
    const using = accountsUsingEmail(db, flow.email)
    const other = (): Refusal => refuse(EMAIL_COPY.otherAccount(id.provider), 400, 'other-account')
    if (userId === null || !using.includes(userId)) return other()
    if (hasEmailOn(db, userId)) return refuse(EMAIL_COPY.alsoHas('email'), 400, 'also-has')
    if (userId !== matchedAccount(db, flow.email)?.userId) return other()
    attachEmail(db, userId, flow.email, flow.password_hash ?? '', nowIso)
    db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(ticketHash)
    inTransaction?.(userId)
    return userId
  })()
  return unwrap(out)
}

async function confirmStep(deps: AppDeps, body: Record<string, unknown>): Promise<StepOutcome> {
  const { db } = deps
  const ticket = text(body, 'ticket')
  const code = text(body, 'code').trim()
  const ticketHash = await sha256Hex(ticket)
  const given = await sha256Hex(`${ticketHash}:${code}`)
  const now = deps.now()
  const nowIso = now.toISOString()
  const out = db.transaction((): StepOutcome | Refusal => {
    pruneExpired(deps, nowIso)
    const flow = db
      .prepare(
        `SELECT ${FLOW_COLUMNS} FROM email_flows WHERE ticket_hash = ? AND expires_at > ? AND confirmed = 0 AND purpose IN ('signup', 'reset')`
      )
      .get(ticketHash, nowIso) as FlowRow | undefined
    if (!flow) return refuse(EMAIL_COPY.codeExpired)
    const bad = checkFlowCode(db, flow, given, nowIso)
    if (bad) return bad
    if (flow.purpose === 'reset') {
      db.prepare(
        'UPDATE email_flows SET confirmed = 1, code_hash = NULL, code_expires_at = NULL, expires_at = ? WHERE ticket_hash = ?'
      ).run(new Date(now.getTime() + CONFIRMED_TTL_MS).toISOString(), ticketHash)
      return { next: 'new-password', ticket }
    }
    if (hasEmailSignIn(db, flow.email)) return refuse(EMAIL_COPY.emailTaken)
    const matched = matchedAccount(db, flow.email)
    if (matched) {
      db.prepare(
        'UPDATE email_flows SET confirmed = 1, code_hash = NULL, code_expires_at = NULL, expires_at = ? WHERE ticket_hash = ?'
      ).run(new Date(now.getTime() + CONFIRMED_TTL_MS).toISOString(), ticketHash)
      return { next: 'match', ticket, email: flow.email, providers: matched.providers }
    }
    return { next: 'signed-in', userId: createFromFlow(db, flow, nowIso), created: true }
  })()
  return unwrap(out)
}

async function resendStep(
  deps: AppDeps,
  body: Record<string, unknown>,
  ip: string
): Promise<StepOutcome> {
  const { db } = deps
  const ticket = text(body, 'ticket')
  const ticketHash = await sha256Hex(ticket)
  const now = deps.now()
  const flow = db
    .prepare(
      `SELECT ${FLOW_COLUMNS} FROM email_flows WHERE ticket_hash = ? AND expires_at > ? AND confirmed = 0 AND purpose IN ('signup', 'reset')`
    )
    .get(ticketHash, now.toISOString()) as FlowRow | undefined
  if (!flow) throw new EmailAuthError(EMAIL_COPY.codeExpired, 400)
  await sendCode(deps, { ticketHash, email: flow.email, purpose: flow.purpose }, ip, now)
  return { next: 'code', ticket, email: flow.email, purpose: flow.purpose as 'signup' | 'reset' }
}

async function forgotStep(
  deps: AppDeps,
  body: Record<string, unknown>,
  ip: string
): Promise<StepOutcome> {
  const { db } = deps
  const email = normalizeEmail(text(body, 'email'))
  if (!takeLimit(db, 'check-ip', ip, deps.now()))
    throw new EmailAuthError(EMAIL_COPY.tooManyTries, 429)
  const userId =
    emailProblem(email) === null ? findAccount(db, { provider: 'email', subject: email }) : null
  if (userId === null) throw new EmailAuthError(EMAIL_COPY.noAccount, 404)
  const ticket = randomToken()
  const ticketHash = await sha256Hex(ticket)
  const now = deps.now()
  const nowIso = now.toISOString()
  const ok = db.transaction(() => {
    pruneExpired(deps, nowIso)
    if (!takeCodeLimits(db, email, ip, now)) return false
    db.prepare("DELETE FROM email_flows WHERE purpose = 'reset' AND email = ?").run(email)
    db.prepare(
      `INSERT INTO email_flows (ticket_hash, purpose, email, user_id, expires_at, created_at)
       VALUES (?, 'reset', ?, ?, ?, ?)`
    ).run(ticketHash, email, userId, new Date(now.getTime() + FLOW_TTL_MS).toISOString(), nowIso)
    return true
  })()
  if (!ok) throw new EmailAuthError(EMAIL_COPY.tooManyCodes, 429)
  try {
    await issueCode(deps, { ticketHash, email, purpose: 'reset' }, now)
  } catch (err) {
    db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(ticketHash)
    throw err
  }
  return { next: 'code', ticket, email, purpose: 'reset' }
}

async function resetStep(deps: AppDeps, body: Record<string, unknown>): Promise<StepOutcome> {
  const { db } = deps
  const ticketHash = await sha256Hex(text(body, 'ticket'))
  const password = text(body, 'password')
  const nowIso = deps.now().toISOString()
  const known = db
    .prepare(
      "SELECT 1 FROM email_flows WHERE ticket_hash = ? AND purpose = 'reset' AND confirmed = 1 AND expires_at > ?"
    )
    .get(ticketHash, nowIso)
  if (!known) throw new EmailAuthError(EMAIL_COPY.codeExpired, 400)
  const problem = passwordProblem(password)
  if (problem) throw new EmailAuthError(problem, 400)
  const passwordHash = await hashPassword(password)
  const out = db.transaction((): StepOutcome | Refusal => {
    const flow = db
      .prepare(
        `SELECT ${FLOW_COLUMNS} FROM email_flows WHERE ticket_hash = ? AND purpose = 'reset' AND confirmed = 1 AND expires_at > ?`
      )
      .get(ticketHash, nowIso) as FlowRow | undefined
    if (!flow || flow.user_id === null) return refuse(EMAIL_COPY.codeExpired)
    const changed = db
      .prepare(
        "UPDATE sign_ins SET password_hash = ? WHERE provider = 'email' AND subject = ? AND user_id = ?"
      )
      .run(passwordHash, flow.email, flow.user_id).changes
    if (changed === 0) return refuse(EMAIL_COPY.noAccount, 404)
    revokeOtherSessions(db, flow.user_id, null)
    db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(ticketHash)
    return { next: 'signed-in', userId: flow.user_id, created: false }
  })()
  return unwrap(out)
}

async function separateStep(deps: AppDeps, body: Record<string, unknown>): Promise<StepOutcome> {
  const { db } = deps
  const ticketHash = await sha256Hex(text(body, 'ticket'))
  const nowIso = deps.now().toISOString()
  const out = db.transaction((): StepOutcome | Refusal => {
    const flow = confirmedSignup(db, ticketHash, nowIso)
    if (!flow) return refuse(EMAIL_COPY.codeExpired, 400, 'expired')
    if (hasEmailSignIn(db, flow.email)) return refuse(EMAIL_COPY.emailTaken)
    return { next: 'signed-in', userId: createFromFlow(db, flow, nowIso), created: true }
  })()
  return unwrap(out)
}

async function linkDiscordStep(deps: AppDeps, body: Record<string, unknown>): Promise<StepOutcome> {
  const taken = await takeLinkCode(deps, body.code, body.verifier)
  if (!taken) throw new EmailAuthError(EMAIL_COPY.linkFailed, 400)
  const userId = await attachFromFlow(
    deps,
    text(body, 'ticket'),
    { provider: 'discord', subject: taken.subject },
    deps.now().toISOString()
  )
  return { next: 'signed-in', userId, created: false }
}

async function linkAppleStep(deps: AppDeps, body: Record<string, unknown>): Promise<StepOutcome> {
  // Only the token and nonce: an authorization code would be traded for a refresh token we'd drop.
  const verified = await verifyAppleSignIn(
    { identityToken: body.identityToken, nonce: body.nonce },
    deps
  )
  if (!verified) throw new EmailAuthError(EMAIL_COPY.linkFailed, 400)
  const userId = await attachFromFlow(
    deps,
    text(body, 'ticket'),
    { provider: 'apple', subject: verified.sub },
    deps.now().toISOString()
  )
  return { next: 'signed-in', userId, created: false }
}

/**
 * A provider claim's ticket, as the step reads it. The JSON route sends it in the body for a
 * desktop-kind claim; the web adapter passes `claimKind: 'web'` and the `email_claim` cookie's
 * value as `claimTicket` (the body is ignored then).
 */
function claimTicket(
  body: Record<string, unknown>,
  ctx: StepContext
): { ticket: string; kind: ClaimRow['kind'] } {
  return ctx.claimKind === 'web'
    ? { ticket: ctx.claimTicket ?? '', kind: 'web' }
    : { ticket: text(body, 'ticket'), kind: 'desktop' }
}

/** Links the claimed Discord or Apple sign-in to the email account, given its password. */
async function claimStep(
  deps: AppDeps,
  body: Record<string, unknown>,
  ctx: StepContext
): Promise<StepOutcome> {
  const { db } = deps
  const now = deps.now()
  const nowIso = now.toISOString()
  const { ticket, kind } = claimTicket(body, ctx)
  const key = await claimKey(ticket, body.verifier)
  const claim = key && peekClaim(db, key, kind, nowIso)
  if (!key || !claim) throw new EmailAuthError(EMAIL_COPY.codeExpired, 400, 'expired')
  const password = text(body, 'password')
  // Keyed by the claimed account's email. Check and record before any await, as passwordStep does.
  if (
    isLimited(db, 'password-email', claim.email.slice(0, MAX_EMAIL_LEN), now) ||
    isLimited(db, 'password-ip', ctx.ip, now)
  )
    throw new EmailAuthError(EMAIL_COPY.tooManyTries, 429)
  const attempts = [
    recordAttempt(db, 'password-email', claim.email.slice(0, MAX_EMAIL_LEN), now),
    recordAttempt(db, 'password-ip', ctx.ip, now)
  ]
  const row = db
    .prepare(
      "SELECT password_hash FROM sign_ins WHERE provider = 'email' AND subject = ? AND user_id = ?"
    )
    .get(claim.email, claim.userId) as { password_hash: string | null } | undefined
  const open = findAccount(db, { provider: 'email', subject: claim.email }) === claim.userId
  if (
    !row?.password_hash ||
    !open ||
    password.length > MAX_PASSWORD ||
    !(await verifyPassword(password, row.password_hash))
  )
    throw new EmailAuthError(EMAIL_COPY.wrongPassword, 400)
  // Only a wrong password counts: the right one takes its attempts back even if the claim is refused.
  for (const id of attempts) forgetAttempt(db, id)
  const out = db.transaction((): StepOutcome | Refusal => {
    const live = peekClaim(db, key, kind, nowIso)
    if (!live || findAccount(db, { provider: 'email', subject: live.email }) !== live.userId)
      return refuse(EMAIL_COPY.codeExpired, 400, 'expired')
    const has = (sql: string, ...args: unknown[]): boolean =>
      db.prepare(sql).get(...args) !== undefined
    if (
      has('SELECT 1 FROM sign_ins WHERE user_id = ? AND provider = ?', live.userId, live.provider)
    )
      return refuse(EMAIL_COPY.alsoHas(live.provider), 400, 'also-has')
    if (
      has('SELECT 1 FROM sign_ins WHERE provider = ? AND subject = ?', live.provider, live.subject)
    ) {
      // Another account took this identity since the claim was made; it is stale.
      spendClaim(db, live.ticketHash)
      return refuse(EMAIL_COPY.codeExpired, 400, 'expired')
    }
    db.prepare(
      'INSERT INTO sign_ins (provider, subject, user_id, created_at, email) VALUES (?, ?, ?, ?, ?)'
    ).run(live.provider, live.subject, live.userId, nowIso, live.email)
    keepAppleToken(db, live, live.userId, nowIso)
    if (live.provider === 'discord' && live.profile.username)
      bindTesterInvites(db, live.userId, live.profile.username)
    refreshLegacyDiscordId(db, live.userId)
    spendClaim(db, live.ticketHash)
    return { next: 'signed-in', userId: live.userId, created: false }
  })()
  return unwrap(out)
}

/** Makes the claimed Discord or Apple sign-in its own account instead of linking it. */
async function claimSeparateStep(
  deps: AppDeps,
  body: Record<string, unknown>,
  ctx: StepContext
): Promise<StepOutcome> {
  const { db } = deps
  const nowIso = deps.now().toISOString()
  const { ticket, kind } = claimTicket(body, ctx)
  const key = await claimKey(ticket, body.verifier)
  const out = db.transaction((): StepOutcome | Refusal => {
    const claim = key && peekClaim(db, key, kind, nowIso)
    if (!claim) return refuse(EMAIL_COPY.codeExpired, 400, 'expired')
    const { userId, created } = signInWith(
      db,
      { provider: claim.provider, subject: claim.subject },
      claim.profile,
      nowIso
    )
    keepAppleToken(db, claim, userId, nowIso)
    if (claim.provider === 'discord' && claim.profile.username)
      bindTesterInvites(db, userId, claim.profile.username)
    spendClaim(db, claim.ticketHash)
    return { next: 'signed-in', userId, created }
  })()
  return unwrap(out)
}

export interface StepContext {
  ip: string
  keepSession?: string
  /** Which kind of sign-in is claiming: the JSON route is 'desktop'; the web adapter is 'web'. */
  claimKind: 'web' | 'desktop'
  /** The web claim's ticket (the `email_claim` cookie); a desktop claim sends it in the body. */
  claimTicket?: string
}

export async function runEmailStep(
  deps: AppDeps,
  step: EmailStep,
  body: Record<string, unknown>,
  ctx: StepContext
): Promise<StepOutcome> {
  switch (step) {
    case 'check':
      return checkStep(deps, body, ctx.ip)
    case 'password':
      return passwordStep(deps, body, ctx.ip)
    case 'create':
      return createStep(deps, body, ctx.ip)
    case 'confirm':
      return confirmStep(deps, body)
    case 'resend':
      return resendStep(deps, body, ctx.ip)
    case 'forgot':
      return forgotStep(deps, body, ctx.ip)
    case 'reset':
      return resetStep(deps, body)
    case 'separate':
      return separateStep(deps, body)
    case 'link-discord':
      return linkDiscordStep(deps, body)
    case 'link-apple':
      return linkAppleStep(deps, body)
    case 'claim':
      return claimStep(deps, body, ctx)
    case 'claim-separate':
      return claimSeparateStep(deps, body, ctx)
    default:
      throw new Error(`email step not implemented: ${step}`)
  }
}

const STEPS: readonly string[] = [
  'check',
  'password',
  'create',
  'confirm',
  'resend',
  'forgot',
  'reset',
  'separate',
  'link-discord',
  'link-apple',
  'claim',
  'claim-separate'
]

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

export function emailStatusRoute(deps: AppDeps): Response {
  return json({ enabled: emailEnabled(deps) })
}

/** `POST /auth/email/:step`: JSON in, JSON out; a finished sign-in answers with a desktop-kind token. */
export async function emailAuthRoute(req: Request, deps: AppDeps, step: string): Promise<Response> {
  if (!emailEnabled(deps)) return json({ error: 'email-off' }, 404)
  if (!STEPS.includes(step)) return json({ error: 'unknown-step' }, 404)
  if (!isJson(req)) return json({ error: 'bad-content-type' }, 415)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad-json' }, 400)
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    return json({ error: 'bad-json' }, 400)
  try {
    const out = await runEmailStep(deps, step as EmailStep, body as Record<string, unknown>, {
      ip: clientIp(req),
      claimKind: 'desktop'
    })
    if (out.next !== 'signed-in') return json(out)
    const token = await mintSession(deps, out.userId, 'desktop', deps.now().toISOString())
    return json({ next: 'signed-in', token, user: loadMe(deps, out.userId), created: out.created })
  } catch (err) {
    if (err instanceof EmailAuthError) return json({ error: err.message }, err.status)
    throw err
  }
}
