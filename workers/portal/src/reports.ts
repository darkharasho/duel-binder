import type { AdminUserReport } from '../../../src/shared/admin'
import {
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  type ReportReason,
  type UserReportInput
} from '../../../src/shared/friends'
import type { SqlDb } from '../../../src/main/db/sql'
import type { AppDeps } from './app'
import { adminWriteAllowed, isAdmin, isJson } from './auth'
import { brandedHtml, escapeHtml, para, small, type EmailMessage } from './emailSend'
import { blockUser, FriendError } from './friends'

/**
 * Reports about other users (App Review guideline 1.2). Anyone you're linked to (a friend, a
 * request either way, or someone you've blocked) can be reported; each report is kept for the
 * admin Reports tab and emailed to the support address so it's seen within a day.
 */

/** Reports one user may send in a rolling day. */
export const DAILY_REPORT_LIMIT = 10
/** Where reports are emailed. */
export const REPORTS_TO = 'support@duelbinder.com'
const DAY_MS = 24 * 60 * 60 * 1000
const REASONS = new Set<string>(REPORT_REASONS.map((r) => r.value))

const labelOf = (reason: ReportReason): string =>
  REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason

/** The checked report, or a FriendError the app shows as it is. */
export function checkReport(v: unknown): Required<UserReportInput> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new FriendError('Report must be an object')
  const r = v as Record<string, unknown>
  if (typeof r.reason !== 'string' || !REASONS.has(r.reason))
    throw new FriendError('Pick a reason for the report')
  if (r.note !== undefined && typeof r.note !== 'string') throw new FriendError('Note must be text')
  const note = ((r.note as string | undefined) ?? '').trim()
  if (note.length > REPORT_NOTE_MAX)
    throw new FriendError(`Keep the note under ${REPORT_NOTE_MAX} characters`)
  if (r.block !== undefined && typeof r.block !== 'boolean')
    throw new FriendError('block must be true or false')
  return { reason: r.reason as ReportReason, note, block: r.block === true }
}

/** Whether `me` has anything to do with `other`: friends, a request either way, or a block by `me`. */
function linked(db: SqlDb, me: number, other: number): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM friendships
          WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
      )
      .get(me, other, other, me) !== undefined ||
    db
      .prepare('SELECT 1 FROM friend_blocks WHERE blocker_id = ? AND blocked_id = ?')
      .get(me, other) !== undefined
  )
}

const nameOf = (db: SqlDb, id: number): string | undefined =>
  (
    db.prepare('SELECT username FROM users WHERE id = ?').get(id) as
      { username: string } | undefined
  )?.username

/** Saves `me`'s report about `userId` (blocking them too when asked) and returns the saved row. */
export function saveReport(
  db: SqlDb,
  me: number,
  userId: number,
  report: Required<UserReportInput>,
  now: Date
): AdminUserReport {
  if (userId === me) throw new FriendError("You can't report yourself")
  const reportedName = nameOf(db, userId)
  if (reportedName === undefined) throw new FriendError('No such user')
  if (!linked(db, me, userId)) throw new FriendError("You can't report this user")
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const { n } = db
    .prepare('SELECT count(*) AS n FROM user_reports WHERE reporter_id = ? AND created_at > ?')
    .get(me, since) as { n: number }
  if (n >= DAILY_REPORT_LIMIT)
    throw new FriendError(
      "You've sent a lot of reports today. Try again tomorrow, or email support@duelbinder.com."
    )
  const reporterName = nameOf(db, me) ?? ''
  const createdAt = now.toISOString()
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO user_reports (reporter_id, reporter_name, reported_id, reported_name, reason, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(me, reporterName, userId, reportedName, report.reason, report.note, createdAt)
  if (report.block) blockUser(db, me, userId, now)
  return {
    id: Number(lastInsertRowid),
    reporterId: me,
    reporterName,
    reportedId: userId,
    reportedName,
    reason: report.reason,
    note: report.note,
    createdAt,
    handledAt: null
  }
}

/** The email the support address gets for a new report. */
export function reportMessage(r: AdminUserReport, publicUrl: string): EmailMessage {
  const admin = `${publicUrl.replace(/\/$/, '')}/admin#reports`
  const subject = `Report: @${r.reportedName} (${labelOf(r.reason)})`
  const lines = [
    `@${r.reporterName} reported @${r.reportedName} (user ${r.reportedId}).`,
    `Reason: ${labelOf(r.reason)}`,
    r.note ? `Note: ${r.note}` : 'No note.',
    '',
    `App Review expects action within 24 hours. Review it in the admin Reports tab: ${admin}`
  ]
  const html = brandedHtml(
    'A user was reported',
    para(
      `<strong>@${escapeHtml(r.reporterName)}</strong> reported <strong>@${escapeHtml(r.reportedName)}</strong> (user ${r.reportedId}).`
    ) +
      para(`Reason: ${escapeHtml(labelOf(r.reason))}`) +
      para(r.note ? `Note: ${escapeHtml(r.note)}` : 'No note.') +
      small(
        `App Review expects action within 24 hours. <a href="${escapeHtml(admin)}" style="color:inherit">Open the Reports tab</a>.`
      ),
    subject,
    'is where Duel Binder sends user reports'
  )
  return { to: REPORTS_TO, subject, text: lines.join('\n'), html }
}

/** Saves the report, then emails it; a failed email leaves the report saved for the admin tab. */
export async function reportUser(
  deps: Pick<AppDeps, 'db' | 'email' | 'env'>,
  me: number,
  userId: number,
  report: Required<UserReportInput>,
  now: Date
): Promise<void> {
  const saved = saveReport(deps.db, me, userId, report, now)
  if (!deps.email) return
  try {
    await deps.email.send(reportMessage(saved, deps.env.PUBLIC_URL))
  } catch (e) {
    console.error('report email failed', e)
  }
}

const SELECT_REPORTS = `SELECT id, reporter_id AS reporterId, reporter_name AS reporterName,
  reported_id AS reportedId, reported_name AS reportedName, reason, note,
  created_at AS createdAt, handled_at AS handledAt FROM user_reports`

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

/** GET /admin/reports (open ones first) and POST /admin/reports/handle `{ id, handled }`. */
export async function adminReportsRoute(req: Request, deps: AppDeps): Promise<Response> {
  const { db } = deps
  const path = new URL(req.url).pathname
  const notFound = json({ error: 'Not found' }, 404)
  if (!(await isAdmin(req, deps))) return notFound
  if (req.method === 'GET' && path === '/admin/reports') {
    const reports = db
      .prepare(
        `${SELECT_REPORTS} ORDER BY handled_at IS NOT NULL, created_at DESC, id DESC LIMIT 500`
      )
      .all() as AdminUserReport[]
    return json({ reports })
  }
  if (req.method !== 'POST' || path !== '/admin/reports/handle') return notFound
  if (!adminWriteAllowed(req, deps)) return notFound
  if (!isJson(req)) return json({ error: 'unsupported-media-type' }, 415)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const id = body?.id
  const handled = body?.handled ?? true
  if (typeof id !== 'number' || !Number.isInteger(id) || typeof handled !== 'boolean')
    return json({ error: 'Bad request' }, 400)
  const done = db
    .prepare('UPDATE user_reports SET handled_at = ? WHERE id = ?')
    .run(handled ? deps.now().toISOString() : null, id)
  return done.changes === 1 ? json({ ok: true }) : notFound
}
