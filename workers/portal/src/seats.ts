import type { AdminSeats, AdminWaitlistEntry } from '../../../src/shared/admin'
import type { SqlDb } from '../../../src/main/db/sql'
import type { AppDeps } from './app'
import { adminWriteAllowed, isAdmin, isJson, randomToken, readCookie, sha256Hex } from './auth'
import { brandedHtml, escapeHtml, para, small, type EmailMessage } from './emailSend'

/**
 * The seat cap: only `cap` open accounts (plus invites not yet used or expired) may exist. People
 * who can't sign up join the waitlist; invites go out oldest first as seats free up, and the owner
 * can invite anyone past the cap.
 */
export class SeatsFull extends Error {
  constructor() {
    super('Duel Binder is full for now')
  }
}

export interface SeatCounts {
  cap: number
  accounts: number
  invited: number
  free: number
  waiting: number
}

export interface SeatPass {
  inviteHash?: string | null
  verifiedEmail?: string | null
}

/** The cookie `/invite/<token>` sets: the raw invite token, carried through a web sign-in. */
export const SEAT_INVITE_COOKIE = 'seat_invite'

/** The raw invite token in the request's `seat_invite` cookie, or null. Hash it with `sha256Hex`. */
export function readSeatInvite(req: Request): string | null {
  return readCookie(req, SEAT_INVITE_COOKIE) || null
}

/** An invite lives two weeks. */
export const INVITE_DAYS = 14
const INVITE_MS = INVITE_DAYS * 24 * 60 * 60 * 1000

export function seatCounts(db: SqlDb, nowIso: string): SeatCounts {
  const cap = (db.prepare('SELECT cap FROM seat_settings WHERE id = 1').get() as { cap: number })
    .cap
  const accounts = (
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE closed_at IS NULL').get() as { n: number }
  ).n
  const invited = (
    db
      .prepare('SELECT COUNT(*) AS n FROM seat_invites WHERE used_at IS NULL AND expires_at > ?')
      .get(nowIso) as { n: number }
  ).n
  const waiting = (
    db.prepare('SELECT COUNT(*) AS n FROM waitlist WHERE invited_at IS NULL').get() as { n: number }
  ).n
  return { cap, accounts, invited, free: Math.max(0, cap - accounts - invited), waiting }
}

export function setCap(db: SqlDb, cap: number, nowIso: string): void {
  if (!Number.isInteger(cap) || cap < 0) throw new RangeError('cap must be an integer >= 0')
  db.prepare('UPDATE seat_settings SET cap = ?, updated_at = ? WHERE id = 1').run(cap, nowIso)
}

/**
 * Inside createAccount's transaction: the invite to spend (its hash), or null when a free seat is
 * used; throws SeatsFull when neither. An invite is tried first, by hash, then by verified email.
 */
export function takeSeat(db: SqlDb, pass: SeatPass, nowIso: string): string | null {
  if (pass.inviteHash && inviteValid(db, pass.inviteHash, nowIso)) return pass.inviteHash
  if (pass.verifiedEmail) {
    const row = db
      .prepare(
        `SELECT token_hash AS h FROM seat_invites
         WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(pass.verifiedEmail.toLowerCase(), nowIso) as { h: string } | undefined
    if (row) return row.h
  }
  if (seatCounts(db, nowIso).free > 0) return null
  throw new SeatsFull()
}

export function spendInvite(db: SqlDb, inviteHash: string, userId: number, nowIso: string): void {
  db.prepare(
    'UPDATE seat_invites SET used_at = ?, used_by = ? WHERE token_hash = ? AND used_at IS NULL'
  ).run(nowIso, userId, inviteHash)
}

export function inviteValid(
  db: SqlDb,
  inviteHash: string,
  nowIso: string
): { expiresAt: string } | null {
  const row = db
    .prepare(
      'SELECT expires_at AS expiresAt FROM seat_invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'
    )
    .get(inviteHash, nowIso) as { expiresAt: string } | undefined
  return row ?? null
}

/** Joins the list (`created_at` is the join date; `queued_at` the place in line, reset on re-queue). */
export function joinWaitlist(db: SqlDb, email: string, nowIso: string): void {
  db.prepare('INSERT OR IGNORE INTO waitlist (email, created_at, queued_at) VALUES (?, ?, ?)').run(
    email.toLowerCase(),
    nowIso,
    nowIso
  )
}

/**
 * Drops one waitlist entry and its open invites. A used invite stays but loses its link to the
 * entry, so a later entry reusing the id isn't taken for one that already joined.
 */
function dropEntry(db: SqlDb, waitlistId: number): boolean {
  db.prepare('DELETE FROM seat_invites WHERE waitlist_id = ? AND used_at IS NULL').run(waitlistId)
  db.prepare('UPDATE seat_invites SET waitlist_id = NULL WHERE waitlist_id = ?').run(waitlistId)
  return db.prepare('DELETE FROM waitlist WHERE id = ?').run(waitlistId).changes > 0
}

/**
 * Inside createAccount's transaction, once the account exists: the person is in, so their place in
 * line and every other invite for them go. That's the waitlist entry of the invite just spent (if
 * any) and every entry and open invite under the account's verified email, so an invitee who signs
 * up some other way doesn't hold a second seat. The spent invite keeps only `used_by`.
 */
export function seatTaken(db: SqlDb, email: string | null, spentHash: string | null): void {
  if (spentHash !== null) {
    const spent = db
      .prepare('SELECT waitlist_id AS w FROM seat_invites WHERE token_hash = ?')
      .get(spentHash) as { w: number | null } | undefined
    if (spent?.w != null) dropEntry(db, spent.w)
    db.prepare("UPDATE seat_invites SET email = '' WHERE token_hash = ?").run(spentHash)
  }
  if (email) forgetEmail(db, email)
}

/** Every waitlist entry and open invite under this email (account sign-up or deletion). */
export function forgetEmail(db: SqlDb, email: string): void {
  const clean = email.toLowerCase()
  const entry = db.prepare('SELECT id FROM waitlist WHERE email = ?').get(clean) as
    { id: number } | undefined
  if (entry) dropEntry(db, entry.id)
  db.prepare('DELETE FROM seat_invites WHERE email = ? AND used_at IS NULL').run(clean)
}

/** True when this entry's invite was used, i.e. the person already has an account. */
export function entryJoined(db: SqlDb, waitlistId: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM seat_invites WHERE waitlist_id = ? AND used_at IS NOT NULL LIMIT 1')
    .get(waitlistId)
}

/**
 * Invite one waitlist entry. False when there's no such entry, it already joined, or no mail went.
 * The admin's Invite now and Resend ignore the cap; `fill` (fillSeats) needs a free seat and an
 * entry not yet invited, both re-checked in the same transaction as the insert.
 */
export async function inviteEntry(
  deps: AppDeps,
  waitlistId: number,
  opts: { fill?: boolean } = {}
): Promise<boolean> {
  const { db } = deps
  const now = deps.now()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + INVITE_MS).toISOString()
  // Token and hash first: the hash awaits, and nothing below may wait between check and insert.
  const token = randomToken()
  const hash = await sha256Hex(token)
  const email = db.transaction((): string | null => {
    const entry = db
      .prepare('SELECT email, invited_at AS invitedAt FROM waitlist WHERE id = ?')
      .get(waitlistId) as { email: string; invitedAt: string | null } | undefined
    if (!entry) return null
    // Their invite was already used: they have an account, so no second seat.
    if (entryJoined(db, waitlistId)) return null
    if (opts.fill && (entry.invitedAt !== null || seatCounts(db, nowIso).free <= 0)) return null
    db.prepare('DELETE FROM seat_invites WHERE waitlist_id = ? AND used_at IS NULL').run(waitlistId)
    db.prepare(
      `INSERT INTO seat_invites (token_hash, waitlist_id, email, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(hash, waitlistId, entry.email, nowIso, expiresAt)
    db.prepare('UPDATE waitlist SET invited_at = ? WHERE id = ?').run(nowIso, waitlistId)
    return entry.email
  })()
  if (email === null) return false
  // A newer invite for the entry (a Resend while this send was out) keeps the entry invited.
  const undo = (): void =>
    db.transaction(() => {
      db.prepare('DELETE FROM seat_invites WHERE token_hash = ?').run(hash)
      const other = db
        .prepare('SELECT 1 FROM seat_invites WHERE waitlist_id = ? AND used_at IS NULL LIMIT 1')
        .get(waitlistId)
      if (!other) db.prepare('UPDATE waitlist SET invited_at = NULL WHERE id = ?').run(waitlistId)
    })()
  if (!deps.email) {
    undo()
    return false
  }
  try {
    await deps.email.send(
      seatInviteMessage(email, `${deps.env.PUBLIC_URL}/invite/${token}`, expiresAt)
    )
    return true
  } catch (e) {
    console.error('seat invite email failed', e)
    undo()
    return false
  }
}

/** The most invites one fill tries, so a big cap raise doesn't outlast the admin's request. */
export const FILL_LIMIT = 25

/**
 * Invite the waitlist in queue order until the free seats run out, trying at most `limit` entries.
 * Returns the invites sent; whoever is left waits for the next fill.
 */
export async function fillSeats(deps: AppDeps, limit = FILL_LIMIT): Promise<number> {
  const { db } = deps
  const nowIso = deps.now().toISOString()
  // An invite that ran out unused gives someone else a turn: its entry goes to the back of the
  // line (created_at stays the date they joined).
  db.prepare(
    `UPDATE waitlist SET invited_at = NULL, queued_at = ?
     WHERE invited_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM seat_invites i WHERE i.waitlist_id = waitlist.id)
       AND NOT EXISTS (SELECT 1 FROM seat_invites i
                       WHERE i.waitlist_id = waitlist.id AND (i.used_at IS NOT NULL OR i.expires_at > ?))`
  ).run(nowIso, nowIso)
  let sent = 0
  const tried = new Set<number>()
  while (tried.size < limit && seatCounts(db, nowIso).free > 0) {
    const rows = db
      .prepare('SELECT id FROM waitlist WHERE invited_at IS NULL ORDER BY queued_at, id')
      .all() as { id: number }[]
    const next = rows.find((r) => !tried.has(r.id))
    if (!next) break
    tried.add(next.id)
    if (await inviteEntry(deps, next.id, { fill: true })) sent++
  }
  return sent
}

/**
 * After an account closes (its transaction committed): its seat goes to the waitlist. A failure is
 * only logged, so it never fails the close.
 */
export async function fillSeatsAfterClose(deps: AppDeps): Promise<void> {
  try {
    await fillSeats(deps)
  } catch (err) {
    console.error('filling seats after an account closed failed', err)
  }
}

/** A fresh link for an entry (voids its old one). */
export const resendInvite = (deps: AppDeps, waitlistId: number): Promise<boolean> =>
  inviteEntry(deps, waitlistId)

export function cancelInvite(db: SqlDb, waitlistId: number): boolean {
  const r = db.transaction(() => {
    db.prepare('DELETE FROM seat_invites WHERE waitlist_id = ? AND used_at IS NULL').run(waitlistId)
    return db.prepare('UPDATE waitlist SET invited_at = NULL WHERE id = ?').run(waitlistId)
  })()
  return r.changes > 0
}

export function deleteEntry(db: SqlDb, waitlistId: number): boolean {
  return db.transaction(() => dropEntry(db, waitlistId))()
}

export function seatInviteMessage(email: string, link: string, expiresAt: string): EmailMessage {
  const until = expiresAt.slice(0, 10)
  const hi = 'A seat opened up at Duel Binder, and it is yours.'
  const note = `The link works until ${until}. After that your seat goes to the next person in line.`
  return {
    to: email,
    subject: 'A seat opened up at Duel Binder',
    text: [hi, 'Create your account here:', link, note].join('\n\n') + '\n',
    html: brandedHtml(
      'A seat opened up',
      para(escapeHtml(hi)) +
        para(
          `<a href="${escapeHtml(link)}" style="color:#c4b5fd;font-weight:600">${escapeHtml(link)}</a>`
        ) +
        small(escapeHtml(note)),
      hi,
      'joined the waitlist on duelbinder.com'
    )
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

const MAX_CAP = 100000

/** The waitlist as the admin tab lists it: waiting first (oldest first), then invited, then joined. */
function adminWaitlist(db: SqlDb, nowIso: string): AdminWaitlistEntry[] {
  const rows = db
    .prepare(
      `SELECT w.id, w.email, w.created_at AS createdAt, w.queued_at AS queuedAt, w.invited_at AS invitedAt,
         (SELECT MAX(i.expires_at) FROM seat_invites i WHERE i.waitlist_id = w.id AND i.used_at IS NULL) AS inviteExpiresAt,
         EXISTS (SELECT 1 FROM seat_invites i WHERE i.waitlist_id = w.id AND i.used_at IS NOT NULL) AS joined
       FROM waitlist w`
    )
    .all() as (Omit<AdminWaitlistEntry, 'status'> & { joined: number; queuedAt: string })[]
  const entries = rows.map(({ joined, ...r }): AdminWaitlistEntry & { queuedAt: string } => {
    const status = joined
      ? 'joined'
      : r.invitedAt === null
        ? 'waiting'
        : r.inviteExpiresAt !== null && r.inviteExpiresAt > nowIso
          ? 'invited'
          : 'expired'
    return { ...r, status }
  })
  const rank = { waiting: 0, expired: 0, invited: 1, joined: 2 } as const
  // In queue order: a re-queued entry sits behind later joiners but keeps its join date.
  return entries
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : a.id - b.id)
    )
    .map(({ queuedAt: _q, ...e }): AdminWaitlistEntry => e)
}

/**
 * Runs a fill and answers `{ ok, invited, left }`: `left` is how many waiting entries still have a
 * free seat (a fill stops at FILL_LIMIT), so the admin can press Fill again.
 */
async function fillReply(deps: AppDeps): Promise<Response> {
  const invited = await fillSeats(deps)
  const c = seatCounts(deps.db, deps.now().toISOString())
  return json({ ok: true, invited, left: Math.min(c.free, c.waiting) })
}

/**
 * GET /admin/seats and the POSTs /admin/seats/{cap,fill,invite,resend,cancel,delete}; owner-only,
 * otherwise 404. Lowering the cap below the accounts in use removes no one: free just stays 0.
 */
export async function adminSeatsRoute(req: Request, deps: AppDeps): Promise<Response> {
  const { db } = deps
  const path = new URL(req.url).pathname
  const notFound = json({ error: 'Not found' }, 404)
  if (!(await isAdmin(req, deps))) return notFound
  if (req.method === 'GET' && path === '/admin/seats') {
    const nowIso = deps.now().toISOString()
    const body: AdminSeats = { counts: seatCounts(db, nowIso), waitlist: adminWaitlist(db, nowIso) }
    return json(body)
  }
  const action = path.startsWith('/admin/seats/') ? path.slice('/admin/seats/'.length) : ''
  if (
    req.method !== 'POST' ||
    !['cap', 'fill', 'invite', 'resend', 'cancel', 'delete'].includes(action)
  )
    return notFound
  if (!adminWriteAllowed(req, deps)) return notFound
  if (!isJson(req)) return json({ error: 'unsupported-media-type' }, 415)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (action === 'cap') {
    const cap = body?.cap
    if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0 || cap > MAX_CAP)
      return json({ error: 'Bad request' }, 400)
    setCap(db, cap, deps.now().toISOString())
    return fillReply(deps)
  }
  if (action === 'fill') return fillReply(deps)
  const id = body?.id
  if (typeof id !== 'number' || !Number.isInteger(id)) return json({ error: 'Bad request' }, 400)
  if (!db.prepare('SELECT 1 FROM waitlist WHERE id = ?').get(id)) return notFound
  if (action === 'delete') return deleteEntry(db, id) ? json({ ok: true }) : notFound
  // invite, resend and cancel: someone who already joined has their seat.
  if (entryJoined(db, id)) return json({ error: 'joined' }, 409)
  if (action === 'cancel') return cancelInvite(db, id) ? json({ ok: true }) : notFound
  const emailed = action === 'invite' ? await inviteEntry(deps, id) : await resendInvite(deps, id)
  return emailed ? json({ ok: true, emailed }) : json({ error: 'email' }, 502)
}
