import type { SqlDb } from '../../../src/main/db/sql'
import { CollectionError } from '../../../src/main/repo/collection'
import type { HistoryExchange, WireValuePoint } from '../../../src/shared/cloud'
import type { GameId } from '../../../src/shared/games'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Far above any real collection; keeps junk out of the chart. */
const MAX_VALUE = 1e10

function checkPoint(v: unknown): WireValuePoint {
  const p = v as Partial<WireValuePoint> | null
  if (
    !p ||
    typeof p.date !== 'string' ||
    !DATE_RE.test(p.date) ||
    typeof p.totalValue !== 'number' ||
    !Number.isFinite(p.totalValue) ||
    p.totalValue < 0 ||
    p.totalValue > MAX_VALUE ||
    typeof p.totalCards !== 'number' ||
    !Number.isSafeInteger(p.totalCards) ||
    p.totalCards < 0
  )
    throw new CollectionError('points must be { date: YYYY-MM-DD, totalValue, totalCards }')
  return { date: p.date, totalValue: p.totalValue, totalCards: p.totalCards }
}

/** Checks a history exchange body. A `today` more than a day past the server's (UTC) date is refused. */
export function checkHistoryExchange(body: unknown, now: Date): HistoryExchange {
  const b = body as { points?: unknown; today?: unknown } | null
  if (!b || !Array.isArray(b.points)) throw new CollectionError('points must be an array')
  if (typeof b.today !== 'string' || !DATE_RE.test(b.today))
    throw new CollectionError('today must be YYYY-MM-DD')
  const latest = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10)
  if (b.today > latest) throw new CollectionError('today is in the future')
  // Days after the device's today would be its clock going backwards; keep them out.
  const points = b.points.map(checkPoint).filter((p) => p.date <= (b.today as string))
  return { points, today: b.today }
}

/**
 * Merges a device's value history into the account's for `game` and answers the whole history.
 * A day the server has keeps the server's value, so every device ends up with the same past; the
 * device's `today` replaces the server's, being the newest reading of that day.
 */
export function exchangeHistory(
  db: SqlDb,
  userId: number,
  game: GameId,
  { points, today }: HistoryExchange
): WireValuePoint[] {
  const keep = db.prepare(
    `INSERT INTO value_snapshots (user_id, game, date, total_value, total_cards) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, game, date) DO NOTHING`
  )
  const replace = db.prepare(
    `INSERT INTO value_snapshots (user_id, game, date, total_value, total_cards) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, game, date) DO UPDATE SET total_value = excluded.total_value,
       total_cards = excluded.total_cards`
  )
  return db.transaction(() => {
    for (const p of points)
      (p.date === today ? replace : keep).run(userId, game, p.date, p.totalValue, p.totalCards)
    return db
      .prepare(
        `SELECT date, total_value AS totalValue, total_cards AS totalCards FROM value_snapshots
         WHERE user_id = ? AND game = ? ORDER BY date`
      )
      .all(userId, game) as WireValuePoint[]
  })()
}
