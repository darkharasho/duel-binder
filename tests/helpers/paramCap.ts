import type Database from 'better-sqlite3'

/** The portal's Durable Object SQLite refuses a statement with more bound parameters than this. */
export const DO_MAX_PARAMS = 100

/**
 * Makes every statement `db` prepares from now on throw when run with more than 100 bound
 * parameters, as DO SQLite does (better-sqlite3 allows 32,766, so tests would pass otherwise).
 * Returns the most parameters any one statement was run with. Call the returned `restore` after.
 */
export function capParams(db: Database.Database): { max: () => number; restore: () => void } {
  const prepare = db.prepare.bind(db)
  let max = 0
  const check = (args: unknown[]): void => {
    const n = args.reduce<number>(
      (sum, a) =>
        sum + (a && typeof a === 'object' && !Buffer.isBuffer(a) ? Object.keys(a).length : 1),
      0
    )
    max = Math.max(max, n)
    if (n > DO_MAX_PARAMS) throw new Error(`too many SQL variables (${n} > ${DO_MAX_PARAMS})`)
  }
  db.prepare = ((sql: string) => {
    const st = prepare(sql)
    for (const m of ['all', 'get', 'run', 'iterate'] as const) {
      const f = (st[m] as (...a: unknown[]) => unknown).bind(st)
      ;(st as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
        check(a)
        return f(...a)
      }
    }
    return st
  }) as typeof db.prepare
  return {
    max: () => max,
    restore: () => {
      db.prepare = prepare as typeof db.prepare
    }
  }
}
