import type { SqlDb } from '../../../src/main/db/sql'

export type LimitKind =
  | 'code-email-min'
  | 'code-email-hour'
  | 'code-ip'
  | 'password-email'
  | 'password-ip'
  | 'check-ip'

const MIN = 60 * 1000
const HOUR = 60 * MIN

export const LIMITS: Record<LimitKind, { max: number; windowMs: number }> = {
  'code-email-min': { max: 1, windowMs: MIN },
  'code-email-hour': { max: 5, windowMs: HOUR },
  'code-ip': { max: 20, windowMs: HOUR },
  'password-email': { max: 10, windowMs: 15 * MIN },
  'password-ip': { max: 50, windowMs: 15 * MIN },
  'check-ip': { max: 100, windowMs: HOUR }
}

export function isLimited(db: SqlDb, kind: LimitKind, key: string, now: Date): boolean {
  const { max, windowMs } = LIMITS[kind]
  const since = new Date(now.getTime() - windowMs).toISOString()
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM auth_limits WHERE kind = ? AND key = ? AND created_at > ?')
    .get(kind, key, since) as { n: number }
  return row.n >= max
}

export function recordAttempt(db: SqlDb, kind: LimitKind, key: string, now: Date): void {
  db.prepare('INSERT INTO auth_limits (kind, key, created_at) VALUES (?, ?, ?)').run(
    kind,
    key,
    now.toISOString()
  )
}

/** Checks, then records when under the limit; false means refused. */
export function takeLimit(db: SqlDb, kind: LimitKind, key: string, now: Date): boolean {
  if (isLimited(db, kind, key, now)) return false
  recordAttempt(db, kind, key, now)
  return true
}

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim().toLowerCase() || 'unknown'
}
