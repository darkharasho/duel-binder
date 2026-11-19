/**
 * What the portal's Durable Object costs to run, from the per-request totals it records
 * (workers/portal/src/costs.ts), and what that would come to at a given number of active users.
 * Prices and included amounts are Cloudflare's Workers Paid plan (Workers and Durable Objects
 * SQLite pricing) as of 2026-11; check https://developers.cloudflare.com/durable-objects/platform/pricing/
 * if the bill disagrees.
 */

/** Requests, SQLite rows read and written, and wall time (ms), summed. */
export interface CostTotals {
  requests: number
  rowsRead: number
  rowsWritten: number
  ms: number
}

export interface CostLine {
  item: string
  /** This month's amount, in `unit`. */
  usage: number
  included: number
  unit: string
  dollars: number
}

export interface CostProjection {
  users: number
  lines: CostLine[]
  dollars: number
}

/** GET /admin/costs. Totals are for the window (`since` onward); `perUserMonth` scales them to 30 days. */
/** One area of one user's requests, in the Costs tab's per-user split. */
export interface UserArea {
  area: string
  requests: number
  rowsRead: number
}

export interface AdminCosts {
  at: string
  since: string
  /** Days in the window that have any totals. */
  days: number
  activeUsers: number
  /** Signed-in users' requests. */
  people: CostTotals
  /** Requests with no signed-in user (catalog uploads, the price alarm, anonymous images). */
  system: CostTotals
  perUserMonth: CostTotals | null
  systemMonth: CostTotals
  /** `areas`: the user's dearest areas by rows read (older portals leave it out). */
  byUser: ({ userId: number; username: string; areas?: UserArea[] } & CostTotals)[]
  byArea: ({ area: string } & CostTotals)[]
  byDay: ({ day: string } & CostTotals)[]
  projections: CostProjection[]
  storageBytes: number | null
}

const PLAN_DOLLARS = 5
/** Durable Objects bill wall time at 128 MB, whatever the object uses. */
const GB_PER_REQUEST = 0.128

const RATES = {
  workerRequests: { included: 10e6, perUnit: 0.3 / 1e6 },
  doRequests: { included: 1e6, perUnit: 0.15 / 1e6 },
  gbSeconds: { included: 400_000, perUnit: 12.5 / 1e6 },
  rowsRead: { included: 25e9, perUnit: 0.001 / 1e6 },
  rowsWritten: { included: 50e6, perUnit: 1 / 1e6 },
  storageGb: { included: 5, perUnit: 0.2 }
} as const

function line(
  item: string,
  usage: number,
  unit: string,
  rate: { included: number; perUnit: number }
): CostLine {
  return {
    item,
    usage,
    included: rate.included,
    unit,
    dollars: Math.max(0, usage - rate.included) * rate.perUnit
  }
}

/**
 * One month at `users` active users: the system's own work plus `users` times one user's month.
 * Worker requests are taken as the Durable Object's, so requests that never reach it (images
 * served from the edge cache, the site) aren't counted; at $0.30 a million they rarely matter.
 * Storage is today's database size; how it grows per user isn't measured.
 */
export function projectMonthly(
  input: { perUser: CostTotals | null; system: CostTotals; storageBytes: number | null },
  users: number
): CostProjection {
  const per = input.perUser ?? { requests: 0, rowsRead: 0, rowsWritten: 0, ms: 0 }
  const month = (k: keyof CostTotals): number => input.system[k] + users * per[k]
  const requests = month('requests')
  const lines: CostLine[] = [
    { item: 'Workers Paid plan', usage: 1, included: 0, unit: 'month', dollars: PLAN_DOLLARS },
    line('Worker requests', requests, 'requests', RATES.workerRequests),
    line('Database requests', requests, 'requests', RATES.doRequests),
    line('Database time', (month('ms') / 1000) * GB_PER_REQUEST, 'GB-s', RATES.gbSeconds),
    line('Rows read', month('rowsRead'), 'rows', RATES.rowsRead),
    line('Rows written', month('rowsWritten'), 'rows', RATES.rowsWritten),
    line('Database storage', (input.storageBytes ?? 0) / 1e9, 'GB', RATES.storageGb)
  ]
  return { users, lines, dollars: lines.reduce((sum, l) => sum + l.dollars, 0) }
}
