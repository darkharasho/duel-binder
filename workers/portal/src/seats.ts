import type { SqlDb } from '../../../src/main/db/sql'
import type { AppDeps } from './app'
import { randomToken, readCookie, sha256Hex } from './auth'
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

export function joinWaitlist(db: SqlDb, email: string, nowIso: string): void {
  db.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)').run(
    email.toLowerCase(),
    nowIso
  )
}

/** Invite one waitlist entry, ignoring the cap. False when there's no such entry or no mail went. */
export async function inviteEntry(deps: AppDeps, waitlistId: number): Promise<boolean> {
  const { db } = deps
  const entry = db.prepare('SELECT email FROM waitlist WHERE id = ?').get(waitlistId) as
    { email: string } | undefined
  if (!entry) return false
  const now = deps.now()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + INVITE_MS).toISOString()
  const token = randomToken()
  const hash = await sha256Hex(token)
  db.transaction(() => {
    db.prepare('DELETE FROM seat_invites WHERE waitlist_id = ? AND used_at IS NULL').run(waitlistId)
    db.prepare(
      `INSERT INTO seat_invites (token_hash, waitlist_id, email, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(hash, waitlistId, entry.email, nowIso, expiresAt)
    db.prepare('UPDATE waitlist SET invited_at = ? WHERE id = ?').run(nowIso, waitlistId)
  })()
  const undo = (): void => {
    db.prepare('DELETE FROM seat_invites WHERE token_hash = ?').run(hash)
    db.prepare('UPDATE waitlist SET invited_at = NULL WHERE id = ?').run(waitlistId)
  }
  if (!deps.email) {
    undo()
    return false
  }
  try {
    await deps.email.send(
      seatInviteMessage(entry.email, `${deps.env.PUBLIC_URL}/invite/${token}`, expiresAt)
    )
    return true
  } catch (e) {
    console.error('seat invite email failed', e)
    undo()
    return false
  }
}

/** Invite the waitlist, oldest first, until the free seats run out. Returns the invites sent. */
export async function fillSeats(deps: AppDeps): Promise<number> {
  const { db } = deps
  const nowIso = deps.now().toISOString()
  // An invite that ran out unused gives someone else a turn: its entry goes back in line.
  db.prepare(
    `UPDATE waitlist SET invited_at = NULL, created_at = ?
     WHERE invited_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM seat_invites i WHERE i.waitlist_id = waitlist.id)
       AND NOT EXISTS (SELECT 1 FROM seat_invites i
                       WHERE i.waitlist_id = waitlist.id AND (i.used_at IS NOT NULL OR i.expires_at > ?))`
  ).run(nowIso, nowIso)
  let sent = 0
  const tried = new Set<number>()
  while (seatCounts(db, nowIso).free > 0) {
    const rows = db
      .prepare('SELECT id FROM waitlist WHERE invited_at IS NULL ORDER BY created_at, id')
      .all() as { id: number }[]
    const next = rows.find((r) => !tried.has(r.id))
    if (!next) break
    tried.add(next.id)
    if (await inviteEntry(deps, next.id)) sent++
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
  return db.transaction(() => {
    db.prepare('DELETE FROM seat_invites WHERE waitlist_id = ? AND used_at IS NULL').run(waitlistId)
    return db.prepare('DELETE FROM waitlist WHERE id = ?').run(waitlistId).changes > 0
  })()
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
