import type { SqlDb } from '../../../src/main/db/sql'
import { createPriceClient, type PriceClient } from '../../../src/main/prices/client'
import { refreshIntlPrices } from '../../../src/main/prices/refresh'

/** Lookups per alarm run. */
export const PRICE_BATCH = 25
/** After a write: soon enough to feel live, late enough to batch a burst of edits. */
export const PRICE_SOON_MS = 5_000
/** More candidates left and the service is answering. */
export const PRICE_MORE_MS = 60_000
/** Every lookup in the run failed. */
export const PRICE_FAILED_MS = 3_600_000
/** Nothing left to price: look again for prices going stale. */
export const PRICE_IDLE_MS = 21_600_000

/** The env slice the price client needs; `PRICES` is the service binding to the eBay price Worker. */
export interface PriceEnv {
  PRICE_WORKER_URL: string
  PRICES?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
}

/**
 * The price alarm's client, or null when PRICE_WORKER_URL is empty. With the PRICES service binding the
 * lookups go through it (a plain fetch to a workers.dev Worker on the same account can fail with error
 * 1042); the binding ignores the host, so PRICE_WORKER_URL stays the URL base either way.
 */
export function priceClientFor(env: PriceEnv): PriceClient | null {
  if (!env.PRICE_WORKER_URL) return null
  const binding = env.PRICES
  return createPriceClient({
    url: env.PRICE_WORKER_URL,
    ...(binding
      ? { fetchFn: (input: RequestInfo | URL, init?: RequestInit) => binding.fetch(input, init) }
      : {})
  })
}

/** The slice of Durable Object storage the price alarm uses. */
export interface AlarmStorage {
  getAlarm(): Promise<number | null>
  setAlarm(t: number): Promise<void>
}

export interface PriceQueue {
  /**
   * Arm the alarm PRICE_SOON_MS ahead unless one is already due sooner. `paced` (price requests, which
   * come often) also keeps an alarm due within PRICE_MORE_MS, so requests never run the alarm faster
   * than its batch pacing.
   */
  soon(opts?: { paced?: boolean }): Promise<void>
}

/**
 * Arms the alarm at `at` unless one is already set at or before it (or at or before `keepWithin`). A time at or before `nowMs` counts as no
 * alarm: inside an alarm handler `getAlarm()` may still return the alarm that is firing.
 */
async function armBy(
  storage: AlarmStorage,
  at: number,
  nowMs: number,
  keepWithin = at
): Promise<void> {
  const current = await storage.getAlarm()
  if (current !== null && current > nowMs && current <= Math.max(at, keepWithin)) return
  await storage.setAlarm(at)
}

export function alarmQueue(storage: AlarmStorage, now: () => number): PriceQueue {
  return {
    // Never rejects: a write that succeeded must not fail because the alarm could not be armed.
    async soon(opts) {
      try {
        const t = now()
        await armBy(storage, t + PRICE_SOON_MS, t, opts?.paced ? t + PRICE_MORE_MS : undefined)
      } catch (e) {
        console.error('Price alarm could not be queued', e)
      }
    }
  }
}

/**
 * One alarm run: refresh up to PRICE_BATCH, then re-arm (more left and something updated → +60 s;
 * all failed → +1 h; else +6 h). Never throws.
 */
export async function runPriceAlarm(
  db: SqlDb,
  client: PriceClient | null,
  storage: AlarmStorage,
  now: () => Date,
  opts: { limit?: number } = {}
): Promise<void> {
  let delay = PRICE_IDLE_MS
  try {
    // refreshIntlPrices never rejects; the catch is for anything around it.
    const r = await refreshIntlPrices(db, client, { now: now(), limit: opts.limit ?? PRICE_BATCH })
    if (r.updated === 0 && r.failed > 0) delay = PRICE_FAILED_MS
    else if (r.remaining > 0 && r.updated > 0) delay = PRICE_MORE_MS
  } catch (e) {
    console.error('Price alarm failed', e)
    delay = PRICE_FAILED_MS
  }
  try {
    // Web writes can run while lookups are in flight; keep an earlier alarm they queued.
    const t = now().getTime()
    await armBy(storage, t + delay, t)
  } catch (e) {
    console.error('Price alarm could not re-arm', e)
  }
}
