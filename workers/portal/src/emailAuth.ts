import type { SqlDb } from '../../../src/main/db/sql'
import {
  CODE_LENGTH,
  EMAIL_COPY,
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
  sha256Hex
} from './auth'
import { isLimited, clientIp, recordAttempt, takeLimit } from './authLimits'
import { codeMessage, emailEnabled } from './emailSend'
import { logServerError } from './errors'
import { hashPassword, verifyPassword } from './password'
import { createAccount, findAccount, refreshLegacyDiscordId } from './signIns'

const MINUTE_MS = 60 * 1000
const CODE_TTL_MS = 15 * MINUTE_MS
const FLOW_TTL_MS = 24 * 60 * MINUTE_MS
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
    readonly status: 400 | 404 | 429
  ) {
    super(message)
  }
}

type Flow = { ticketHash: string; email: string; purpose: 'signup' | 'reset' }

interface FlowRow {
  ticket_hash: string
  purpose: 'signup' | 'reset'
  email: string
  user_id: number | null
  password_hash: string | null
  code_hash: string | null
  code_expires_at: string | null
  tries: number
  confirmed: number
}

/** A refusal found inside a transaction; thrown after commit so the step's other writes (a try count) stay. */
type Refusal = { refuse: EmailAuthError }
const refuse = (message: string, status: 400 | 404 | 429 = 400): Refusal => ({
  refuse: new EmailAuthError(message, status)
})
const unwrap = <T>(r: T | Refusal): T => {
  if (r !== null && typeof r === 'object' && 'refuse' in r) throw (r as Refusal).refuse
  return r as T
}

const FLOW_COLUMNS =
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

/**
 * Makes a fresh code for the flow and mails it. The three send limits apply first (a refusal
 * records nothing); a new code replaces the old one and resets the tries.
 */
export async function sendCode(deps: AppDeps, flow: Flow, ip: string, now: Date): Promise<void> {
  const { db } = deps
  const kinds = [
    ['code-email-min', flow.email],
    ['code-email-hour', flow.email],
    ['code-ip', ip]
  ] as const
  const code = newCode()
  const codeHash = await sha256Hex(`${flow.ticketHash}:${code}`)
  const limited = db.transaction(() => {
    if (kinds.some(([kind, key]) => isLimited(db, kind, key, now))) return true
    for (const [kind, key] of kinds) recordAttempt(db, kind, key, now)
    db.prepare(
      'UPDATE email_flows SET code_hash = ?, code_expires_at = ?, tries = 0 WHERE ticket_hash = ?'
    ).run(codeHash, new Date(now.getTime() + CODE_TTL_MS).toISOString(), flow.ticketHash)
    return false
  })()
  if (limited) throw new EmailAuthError(EMAIL_COPY.tooManyCodes, 429)
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
  const now = deps.now()
  const email = normalizeEmail(text(body, 'email'))
  const password = text(body, 'password')
  if (isLimited(db, 'password-email', email, now) || isLimited(db, 'password-ip', ip, now))
    throw new EmailAuthError(EMAIL_COPY.tooManyTries, 429)
  const row =
    emailProblem(email) === null && password.length <= MAX_PASSWORD
      ? (db
          .prepare(
            "SELECT user_id, password_hash FROM sign_ins WHERE provider = 'email' AND subject = ?"
          )
          .get(email) as { user_id: number; password_hash: string | null } | undefined)
      : undefined
  const userId = row?.password_hash ? findAccount(db, { provider: 'email', subject: email }) : null
  if (row?.password_hash && userId !== null && (await verifyPassword(password, row.password_hash)))
    return { next: 'signed-in', userId, created: false }
  recordAttempt(db, 'password-email', email.slice(0, 254), now)
  recordAttempt(db, 'password-ip', ip, now)
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
  const passwordHash = await hashPassword(password)
  const ticket = randomToken()
  const ticketHash = await sha256Hex(ticket)
  const now = deps.now()
  const nowIso = now.toISOString()
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
    await sendCode(deps, { ticketHash, email, purpose: 'signup' }, ip, now)
  } catch (err) {
    db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(ticketHash)
    throw err
  }
  return { next: 'code', ticket, email, purpose: 'signup' }
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
        `SELECT ${FLOW_COLUMNS} FROM email_flows WHERE ticket_hash = ? AND expires_at > ? AND confirmed = 0`
      )
      .get(ticketHash, nowIso) as FlowRow | undefined
    if (!flow || !flow.code_hash || !flow.code_expires_at || flow.code_expires_at <= nowIso)
      return refuse(EMAIL_COPY.codeExpired)
    if (!sameString(given, flow.code_hash)) {
      const tries = flow.tries + 1
      if (tries >= MAX_TRIES) {
        db.prepare(
          'UPDATE email_flows SET code_hash = NULL, code_expires_at = NULL, tries = ? WHERE ticket_hash = ?'
        ).run(tries, ticketHash)
        return refuse(EMAIL_COPY.codeExpired)
      }
      db.prepare('UPDATE email_flows SET tries = ? WHERE ticket_hash = ?').run(tries, ticketHash)
      return refuse(EMAIL_COPY.codeWrong)
    }
    if (flow.purpose === 'reset') {
      db.prepare(
        'UPDATE email_flows SET confirmed = 1, code_hash = NULL, code_expires_at = NULL, expires_at = ? WHERE ticket_hash = ?'
      ).run(new Date(now.getTime() + CONFIRMED_TTL_MS).toISOString(), ticketHash)
      return { next: 'new-password', ticket }
    }
    if (hasEmailSignIn(db, flow.email)) return refuse(EMAIL_COPY.emailTaken)
    const userId = createAccount(
      db,
      { provider: 'email', subject: flow.email },
      { displayName: null, avatar: null },
      nowIso
    )
    db.prepare(
      "UPDATE sign_ins SET email = ?, password_hash = ? WHERE provider = 'email' AND subject = ?"
    ).run(flow.email, flow.password_hash, flow.email)
    db.prepare('DELETE FROM email_flows WHERE ticket_hash = ?').run(ticketHash)
    return { next: 'signed-in', userId, created: true }
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
      `SELECT ${FLOW_COLUMNS} FROM email_flows WHERE ticket_hash = ? AND expires_at > ? AND confirmed = 0`
    )
    .get(ticketHash, now.toISOString()) as FlowRow | undefined
  if (!flow) throw new EmailAuthError(EMAIL_COPY.codeExpired, 400)
  await sendCode(deps, { ticketHash, email: flow.email, purpose: flow.purpose }, ip, now)
  return { next: 'code', ticket, email: flow.email, purpose: flow.purpose }
}

async function forgotStep(
  deps: AppDeps,
  body: Record<string, unknown>,
  ip: string
): Promise<StepOutcome> {
  const { db } = deps
  const email = normalizeEmail(text(body, 'email'))
  const userId =
    emailProblem(email) === null ? findAccount(db, { provider: 'email', subject: email }) : null
  if (userId === null) throw new EmailAuthError(EMAIL_COPY.noAccount, 404)
  const ticket = randomToken()
  const ticketHash = await sha256Hex(ticket)
  const now = deps.now()
  const nowIso = now.toISOString()
  db.transaction(() => {
    pruneExpired(deps, nowIso)
    db.prepare("DELETE FROM email_flows WHERE purpose = 'reset' AND email = ?").run(email)
    db.prepare(
      `INSERT INTO email_flows (ticket_hash, purpose, email, user_id, expires_at, created_at)
       VALUES (?, 'reset', ?, ?, ?, ?)`
    ).run(ticketHash, email, userId, new Date(now.getTime() + FLOW_TTL_MS).toISOString(), nowIso)
  })()
  try {
    await sendCode(deps, { ticketHash, email, purpose: 'reset' }, ip, now)
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

export async function runEmailStep(
  deps: AppDeps,
  step: EmailStep,
  body: Record<string, unknown>,
  ctx: { ip: string; keepSession?: string }
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
  'reset'
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
      ip: clientIp(req)
    })
    if (out.next !== 'signed-in') return json(out)
    const token = await mintSession(deps, out.userId, 'desktop', deps.now().toISOString())
    return json({ next: 'signed-in', token, user: loadMe(deps, out.userId), created: out.created })
  } catch (err) {
    if (err instanceof EmailAuthError) return json({ error: err.message }, err.status)
    throw err
  }
}
