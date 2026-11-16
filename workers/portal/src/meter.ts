import { AsyncLocalStorage } from 'node:async_hooks'

/** One day's totals for one user (0 = no signed-in user) and one area, as costs.ts stores them. */
export interface CostRow {
  day: string
  userId: number
  area: string
  requests: number
  rowsRead: number
  rowsWritten: number
  ms: number
}

/**
 * Adds up what each Durable Object request costs: SQLite rows read and written (doSql reports
 * every statement's) and wall time, kept by UTC day, signed-in user and area. Requests overlap
 * while one waits on a fetch, so each runs in its own AsyncLocalStorage scope (the Worker needs the
 * nodejs_als compatibility flag). Totals stay in memory until take(); a restart loses at most what
 * hasn't been taken, which is fine for estimates.
 */
export interface CostMeter {
  run<T>(area: string, fn: () => Promise<T>): Promise<T>
  /** Rows one statement read and wrote; counted against the request it ran in, if any. */
  rows(read: number, written: number): void
  /** The signed-in user the current request is for. */
  user(id: number): void
  /** Everything since the last take, and starts over. */
  take(): CostRow[]
  /** Whether a minute has passed since the last take. */
  due(): boolean
}

const FLUSH_EVERY_MS = 60_000

interface Scope {
  area: string
  userId: number
  day: string
  rowsRead: number
  rowsWritten: number
  /** Once the request has answered, its later rows go straight to the totals. */
  done: boolean
}

export function createCostMeter(now: () => number): CostMeter {
  const als = new AsyncLocalStorage<Scope>()
  let pending = new Map<string, CostRow>()
  let lastTake = now()

  function add(s: Scope, part: Partial<CostRow>): void {
    const key = `${s.day}|${s.userId}|${s.area}`
    const row = pending.get(key) ?? {
      day: s.day,
      userId: s.userId,
      area: s.area,
      requests: 0,
      rowsRead: 0,
      rowsWritten: 0,
      ms: 0
    }
    row.requests += part.requests ?? 0
    row.rowsRead += part.rowsRead ?? 0
    row.rowsWritten += part.rowsWritten ?? 0
    row.ms += part.ms ?? 0
    pending.set(key, row)
  }

  return {
    async run(area, fn) {
      const start = now()
      const scope: Scope = {
        area,
        userId: 0,
        day: new Date(start).toISOString().slice(0, 10),
        rowsRead: 0,
        rowsWritten: 0,
        done: false
      }
      try {
        return await als.run(scope, fn)
      } finally {
        scope.done = true
        add(scope, {
          requests: 1,
          rowsRead: scope.rowsRead,
          rowsWritten: scope.rowsWritten,
          ms: Math.max(0, now() - start)
        })
      }
    },
    rows(read, written) {
      const s = als.getStore()
      if (!s) return
      if (s.done) add(s, { rowsRead: read, rowsWritten: written })
      else {
        s.rowsRead += read
        s.rowsWritten += written
      }
    },
    user(id) {
      const s = als.getStore()
      if (s && !s.done) s.userId = id
    },
    take() {
      const rows = [...pending.values()]
      pending = new Map()
      lastTake = now()
      return rows
    },
    due() {
      return now() - lastTake >= FLUSH_EVERY_MS
    }
  }
}

const KNOWN = new Set(['api', 'admin', 'auth', 'scan', 'img', 'stripe', 'supporter'])
const PART = /^[a-z][a-z0-9-]{0,31}$/
const CHANNEL = /^[a-z][a-zA-Z0-9:-]{0,47}$/

/**
 * A request's area: its first two path parts for the app's own routes (`api/sync`,
 * `admin/catalog`), each RPC channel on its own (`rpc sets:list`), and `img` for all art. Anything
 * else is `other`, so stray paths can't add rows to the table.
 */
export function areaOf(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return 'home'
  const [first, second] = parts
  if (!KNOWN.has(first)) return 'other'
  if (first === 'img') return 'img'
  if (first === 'api' && second === 'rpc') {
    let channel: string
    try {
      channel = decodeURIComponent(parts[2] ?? '')
    } catch {
      return 'rpc'
    }
    return CHANNEL.test(channel) ? `rpc ${channel}` : 'rpc'
  }
  return second !== undefined && PART.test(second) ? `${first}/${second}` : first
}
