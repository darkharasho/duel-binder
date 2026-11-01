import type { AppDeps } from './app'
import { readCalls, utcDay } from './sweep'

const DAY_MS = 24 * 60 * 60 * 1000

/** Tables whose row counts show where the space goes. One query each: DO SQLite rejects long compound selects. */
const COUNTED_TABLES = [
  'cards',
  'card_printings',
  'card_images',
  'users',
  'sessions',
  'collection_entries',
  'value_snapshots',
  'friendships',
  'printing_contributions',
  'catalog_tombstones',
  'usage_daily',
  'error_reports',
  'price_sweeps'
]

/** Users, activity, collections, friends and storage, for GET /admin/stats. */
export function collectStats(deps: AppDeps): Record<string, unknown> {
  const { db } = deps
  const now = deps.now()
  const nowIso = now.toISOString()
  const since = (days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString()
  const one = <T>(sql: string, ...args: unknown[]): T => db.prepare(sql).get(...args) as T
  const count = (sql: string, ...args: unknown[]): number => one<{ n: number }>(sql, ...args).n

  const users = one<{ total: number; apple: number }>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(discord_id LIKE 'apple:%'), 0) AS apple FROM users"
  )
  const collections = one<{ collectors: number; entries: number; cards: number }>(
    `SELECT COUNT(DISTINCT user_id) AS collectors, COUNT(*) AS entries, COALESCE(SUM(quantity), 0) AS cards
     FROM collection_entries WHERE deleted_at IS NULL`
  )
  const rows: Record<string, number> = {}
  for (const t of COUNTED_TABLES) rows[t] = count(`SELECT COUNT(*) AS n FROM ${t}`)

  return {
    at: nowIso,
    users: {
      total: users.total,
      discord: users.total - users.apple,
      apple: users.apple,
      new7d: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since(7)),
      new30d: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since(30))
    },
    // Stamped at most hourly per user, so these are accurate to the hour.
    active: {
      day: count('SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?', since(1)),
      week: count('SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?', since(7)),
      month: count('SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?', since(30))
    },
    sessions: Object.fromEntries(
      (
        db
          .prepare('SELECT kind, COUNT(*) AS n FROM sessions WHERE expires_at > ? GROUP BY kind')
          .all(nowIso) as { kind: string; n: number }[]
      ).map((r) => [r.kind, r.n])
    ),
    collections: {
      ...collections,
      largest: db
        .prepare(
          `SELECT u.username, COUNT(*) AS entries, SUM(e.quantity) AS cards
           FROM collection_entries e JOIN users u ON u.id = e.user_id
           WHERE e.deleted_at IS NULL GROUP BY e.user_id ORDER BY entries DESC LIMIT 10`
        )
        .all() as { username: string; entries: number; cards: number }[]
    },
    friends: {
      accepted: count("SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted'"),
      pending: count("SELECT COUNT(*) AS n FROM friendships WHERE status = 'pending'"),
      blocks: count('SELECT COUNT(*) AS n FROM friend_blocks')
    },
    scan: {
      contributions: rows.printing_contributions,
      contributions7d: count(
        'SELECT COUNT(*) AS n FROM printing_contributions WHERE created_at >= ?',
        since(7)
      )
    },
    priceRequests: {
      today: count(
        'SELECT COALESCE(SUM(count), 0) AS n FROM price_request_log WHERE day = ?',
        nowIso.slice(0, 10)
      ),
      last7d: count(
        'SELECT COALESCE(SUM(count), 0) AS n FROM price_request_log WHERE day >= ?',
        since(7).slice(0, 10)
      )
    },
    sweep: {
      callsToday: readCalls(db, utcDay(now)),
      sweptLast7d: count('SELECT COUNT(*) AS n FROM price_sweeps WHERE swept_at >= ?', since(7)),
      prefixes: rows.price_sweeps
    },
    // Anonymous app usage over the last 30 days; see src/shared/usage.ts.
    usage: {
      since: since(30).slice(0, 10),
      totals: db
        .prepare(
          `SELECT event, platform, SUM(count) AS count FROM usage_daily WHERE day >= ?
           GROUP BY event, platform ORDER BY event, platform`
        )
        .all(since(30).slice(0, 10)) as { event: string; platform: string; count: number }[],
      opensByDay: db
        .prepare(
          `SELECT day, SUM(count) AS count FROM usage_daily WHERE event = 'open' AND day >= ?
           GROUP BY day ORDER BY day`
        )
        .all(since(30).slice(0, 10)) as { day: string; count: number }[]
    },
    storage: {
      databaseBytes: deps.storageBytes?.() ?? null,
      rows
    }
  }
}
