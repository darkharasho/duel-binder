import { checkUsageReport } from '../../../src/shared/usage'
import type { AppDeps } from './app'
import { currentUser, fromPublicOrigin } from './auth'

/** Reports one account may send in an hour; the apps send one every few minutes at most. */
const REPORTS_PER_HOUR = 30
const HOUR_MS = 60 * 60 * 1000

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
 * POST /api/usage `{ platform, events }`. A session is needed so strangers can't spend the free
 * plan's writes, but the counts are added to the day's totals without the account.
 */
export async function reportUsage(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const user = await currentUser(req, deps)
  if (!user) return json({ error: 'signed-out' }, 401)
  if (user.kind === 'web' && !fromPublicOrigin(req, deps)) return json({ error: 'bad-origin' }, 403)

  let report
  try {
    report = checkUsageReport(await req.json())
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'bad-report' }, 400)
  }
  if (!allowed(deps, user.id)) return json({ error: 'too-many' }, 429)

  const day = deps.now().toISOString().slice(0, 10)
  const add = deps.db.prepare(
    `INSERT INTO usage_daily (day, platform, event, count) VALUES (?, ?, ?, ?)
     ON CONFLICT (day, platform, event) DO UPDATE SET count = count + excluded.count`
  )
  for (const [event, count] of Object.entries(report.events))
    add.run(day, report.platform, event, count)
  return new Response(null, { status: 204 })
}
