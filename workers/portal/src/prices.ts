import type { SqlDb } from '../../../src/main/db/sql'
import type { PriceClient } from '../../../src/main/prices/client'
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

/** The slice of Durable Object storage the price alarm uses. */
export interface AlarmStorage {
  getAlarm(): Promise<number | null>
  setAlarm(t: number): Promise<void>
}

export interface PriceQueue {
  /** Arm the alarm PRICE_SOON_MS ahead unless one is already due sooner. */
  soon(): Promise<void>
}

export function alarmQueue(storage: AlarmStorage, now: () => number): PriceQueue {
  return {
    async soon() {
      const at = now() + PRICE_SOON_MS
      const current = await storage.getAlarm()
      if (current !== null && current <= at) return
      await storage.setAlarm(at)
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
    await storage.setAlarm(now().getTime() + delay)
  } catch (e) {
    console.error('Price alarm could not re-arm', e)
  }
}
