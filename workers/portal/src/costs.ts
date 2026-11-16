import type { SqlDb } from '../../../src/main/db/sql'
import { projectMonthly, type AdminCosts, type CostTotals } from '../../../src/shared/costs'
import type { AppDeps } from './app'
import type { CostRow } from './meter'

/** How long request_costs keeps a day. */
const KEEP_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
/** The user counts every projection shows, besides today's. */
const SCENARIOS = [100, 500, 5000]
const TOP_USERS = 20
const TOP_AREAS = 30

const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10)

/**
 * Adds the meter's totals onto request_costs (server-46), one upsert per day, user and area, and
 * drops days past KEEP_DAYS. Called about once a minute, so the counting costs a few writes a minute.
 */
export function flushCosts(db: SqlDb, rows: CostRow[], now: Date): void {
  if (rows.length === 0) return
  const upsert = db.prepare(
    `INSERT INTO request_costs (day, user_id, area, requests, rows_read, rows_written, ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day, user_id, area) DO UPDATE SET
       requests = requests + excluded.requests,
       rows_read = rows_read + excluded.rows_read,
       rows_written = rows_written + excluded.rows_written,
       ms = ms + excluded.ms`
  )
  db.transaction(() => {
    for (const r of rows)
      upsert.run(r.day, r.userId, r.area, r.requests, r.rowsRead, r.rowsWritten, Math.round(r.ms))
    db.prepare('DELETE FROM request_costs WHERE day < ?').run(
      utcDay(now.getTime() - KEEP_DAYS * DAY_MS)
    )
  })()
}

interface Summed {
  requests: number
  rows_read: number
  rows_written: number
  ms: number
}

const SUMS =
  'SUM(requests) AS requests, SUM(rows_read) AS rows_read, SUM(rows_written) AS rows_written, SUM(ms) AS ms'

const totals = (r: Summed): CostTotals => ({
  requests: r.requests,
  rowsRead: r.rows_read,
  rowsWritten: r.rows_written,
  ms: r.ms
})

const plus = (a: CostTotals, b: CostTotals): CostTotals => ({
  requests: a.requests + b.requests,
  rowsRead: a.rowsRead + b.rowsRead,
  rowsWritten: a.rowsWritten + b.rowsWritten,
  ms: a.ms + b.ms
})

const scaled = (t: CostTotals, by: number): CostTotals => ({
  requests: t.requests * by,
  rowsRead: t.rowsRead * by,
  rowsWritten: t.rowsWritten * by,
  ms: t.ms * by
})

const NONE: CostTotals = { requests: 0, rowsRead: 0, rowsWritten: 0, ms: 0 }

/**
 * GET /admin/costs: the last `days` UTC days (today included) of request_costs. People are
 * requests with a signed-in user; the rest (catalog uploads, the price alarm, signed-out images) is
 * system work, which doesn't grow with users. A month is 30 days, scaled from the days measured.
 */
export function collectCosts(deps: AppDeps, days: number): AdminCosts {
  const { db } = deps
  const now = deps.now()
  const since = utcDay(now.getTime() - (days - 1) * DAY_MS)
  const groups = db
    .prepare(
      `SELECT user_id, area, ${SUMS} FROM request_costs WHERE day >= ? GROUP BY user_id, area`
    )
    .all(since) as (Summed & { user_id: number; area: string })[]
  const byDay = (
    db
      .prepare(`SELECT day, ${SUMS} FROM request_costs WHERE day >= ? GROUP BY day ORDER BY day`)
      .all(since) as (Summed & { day: string })[]
  ).map((r) => ({ day: r.day, ...totals(r) }))

  let people = NONE
  let system = NONE
  const users = new Map<number, CostTotals>()
  const areas = new Map<string, CostTotals>()
  for (const g of groups) {
    const t = totals(g)
    if (g.user_id > 0) {
      people = plus(people, t)
      users.set(g.user_id, plus(users.get(g.user_id) ?? NONE, t))
    } else system = plus(system, t)
    areas.set(g.area, plus(areas.get(g.area) ?? NONE, t))
  }

  const top = [...users].sort((a, b) => b[1].rowsRead - a[1].rowsRead).slice(0, TOP_USERS)
  const names = new Map(
    (
      db
        .prepare('SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(top.map(([id]) => id))) as { id: number; username: string }[]
    ).map((u) => [u.id, u.username])
  )

  const measured = byDay.length
  const toMonth = measured === 0 ? 0 : 30 / measured
  const activeUsers = users.size
  const perUserMonth = activeUsers === 0 ? null : scaled(people, toMonth / activeUsers)
  const systemMonth = scaled(system, toMonth)
  const storageBytes = deps.storageBytes?.() ?? null
  const counts = [...new Set([...(activeUsers > 0 ? [activeUsers] : []), ...SCENARIOS])]

  return {
    at: now.toISOString(),
    since,
    days: measured,
    activeUsers,
    people,
    system,
    perUserMonth,
    systemMonth,
    byUser: top.map(([userId, t]) => ({
      userId,
      username: names.get(userId) ?? `#${userId}`,
      ...t
    })),
    byArea: [...areas]
      .map(([area, t]) => ({ area, ...t }))
      .sort((a, b) => b.rowsRead - a.rowsRead)
      .slice(0, TOP_AREAS),
    byDay,
    projections: counts.map((n) =>
      projectMonthly({ perUser: perUserMonth, system: systemMonth, storageBytes }, n)
    ),
    storageBytes
  }
}

/** GET /admin/costs?days=7|30 (30 by default); writes what the meter holds first, so it's current. */
export function costsResponse(req: Request, deps: AppDeps): Response {
  if (deps.meter) flushCosts(deps.db, deps.meter.take(), deps.now())
  const asked = Number(new URL(req.url).searchParams.get('days'))
  const days = asked === 7 ? 7 : 30
  return new Response(JSON.stringify(collectCosts(deps, days)), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })
}
