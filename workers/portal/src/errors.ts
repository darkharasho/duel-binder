import { checkErrorReport, scrubErrorDetails } from '../../../src/shared/errorReports'
import type { AppDeps } from './app'
import { currentUser, fromPublicOrigin } from './auth'

/** Reports one account may send in an hour; an app run sends ten at most. */
const REPORTS_PER_HOUR = 20
const HOUR_MS = 60 * 60 * 1000
const KEEP_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
/** Reports the dashboard shows. */
const LATEST = 200

// Report times per user, only to cap them: kept in memory, never stored, and lost on restart.
const recent = new WeakMap<AppDeps['db'], Map<number, number[]>>()

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

function allowed(deps: AppDeps, userId: number): boolean {
  const byUser = recent.get(deps.db) ?? new Map<number, number[]>()
  recent.set(deps.db, byUser)
  const now = deps.now().getTime()
  const times = (byUser.get(userId) ?? []).filter((t) => t > now - HOUR_MS)
  if (times.length >= REPORTS_PER_HOUR) return false
  times.push(now)
  byUser.set(userId, times)
  return true
}

/**
 * POST /api/errors `{ platform, appVersion, message, stack? }`. As with /api/usage, a session is
 * needed so strangers can't spend the free plan's writes, but nothing about the account is stored.
 * The text is scrubbed again here: the sender can't be relied on, old or modified as it may be.
 */
export async function reportError(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const user = await currentUser(req, deps)
  if (!user) return json({ error: 'signed-out' }, 401)
  if (user.kind === 'web' && !fromPublicOrigin(req, deps)) return json({ error: 'bad-origin' }, 403)

  let report
  try {
    report = scrubErrorDetails(checkErrorReport(await req.json()))
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'bad-report' }, 400)
  }
  if (!allowed(deps, user.id)) return json({ error: 'too-many' }, 429)

  const now = deps.now()
  const cutoff = new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10)
  deps.db.prepare('DELETE FROM error_reports WHERE day < ?').run(cutoff)
  deps.db
    .prepare(
      'INSERT INTO error_reports (day, platform, app_version, message, stack) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      now.toISOString().slice(0, 10),
      report.platform,
      report.appVersion,
      report.message,
      report.stack ?? null
    )
  return new Response(null, { status: 204 })
}

interface ErrorRow {
  day: string
  platform: string
  appVersion: string
  message: string
  stack: string | null
}

export interface ErrorGroup {
  message: string
  count: number
  reports: Omit<ErrorRow, 'message'>[]
}

/** The latest reports, grouped by identical message, for GET /admin/errors; newest group first. */
export function collectErrors(deps: AppDeps): ErrorGroup[] {
  const rows = deps.db
    .prepare(
      `SELECT day, platform, app_version AS appVersion, message, stack FROM error_reports
       ORDER BY id DESC LIMIT ?`
    )
    .all(LATEST) as ErrorRow[]
  const groups = new Map<string, ErrorGroup>()
  for (const { message, ...report } of rows) {
    const group = groups.get(message) ?? { message, count: 0, reports: [] }
    group.count += 1
    group.reports.push(report)
    groups.set(message, group)
  }
  return [...groups.values()]
}
