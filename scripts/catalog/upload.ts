import type Database from 'better-sqlite3'
import { getMeta } from '../../src/main/db/meta'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import { diffTable } from './diff'

/**
 * Rows (or delete keys) per request. Every signed-in request goes through the portal's one Durable
 * Object, which runs a batch start to finish before anything queued behind it, so a batch's CPU
 * time is how long users wait. Measured on the 2026-11-12 full upload (2,000-row batches): printings
 * took about 1.5 s CPU per batch (0.75 ms a row: a pkey lookup, an update and the change-feed
 * trigger), up to 3.8 s at p99 and 8.7 s at worst; every other table about 0.5 s (0.25 ms a row).
 * These sizes put the average near 0.2 s and the worst case near 1 s.
 */
export const DEFAULT_BATCH = 500
export const TABLE_BATCH: Readonly<Record<string, number>> = { card_printings: 250 }

/** Waits before each retry; a request is tried once plus once per entry. */
const RETRY_DELAYS_MS = [1000, 2000, 4000]

/**
 * The rest after each batch, so requests queued behind it get the Durable Object to themselves:
 * `factor` times the batch's round trip (a busy portal answers slower, so the job backs off more),
 * kept within [minMs, maxMs]. 0.5 keeps the upload to about two thirds of the object's time at most.
 */
export interface UploadPace {
  minMs: number
  maxMs: number
  factor: number
}

export const DEFAULT_PACE: UploadPace = { minMs: 200, maxMs: 2000, factor: 0.5 }
/** For tests: no rest between batches. */
export const NO_PAUSE: UploadPace = { minMs: 0, maxMs: 0, factor: 0 }

/** How long to rest after a batch whose request took `elapsedMs`. */
export const pauseAfter = (elapsedMs: number, pace: UploadPace): number =>
  Math.min(pace.maxMs, Math.max(pace.minMs, Math.round(elapsedMs * pace.factor)))

export interface UploadOptions {
  url: string
  token: string
  work: Database.Database
  base: Database.Database | null
  fetch?: typeof fetch
  /** Rows per request for every table, instead of DEFAULT_BATCH and TABLE_BATCH. */
  batch?: number
  /** Defaults to DEFAULT_PACE. */
  pace?: UploadPace
  /** Waits between batches; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>
  /** Clock for timing each batch; defaults to Date.now. */
  now?: () => number
}

/** Rows per request for `table`. */
export const batchFor = (table: string, override?: number): number =>
  override ?? TABLE_BATCH[table] ?? DEFAULT_BATCH

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** 429 and 5xx are worth retrying; any other 4xx means the request itself is wrong. */
const retryable = (e: unknown): boolean =>
  !(e instanceof HttpError) || e.status === 429 || e.status >= 500

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `fn`, retrying network errors, 429 and 5xx after RETRY_DELAYS_MS; any other failure
 * rejects at once. Each retry warns with `label`.
 */
export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (attempt >= RETRY_DELAYS_MS.length || !retryable(e)) throw e
      console.warn(`${label} attempt ${attempt + 1} failed, retrying:`, e instanceof Error ? e.message : e)
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Sends what changed in `work` since `base` to the portal's admin endpoints: deletions in
 * reverse `CATALOG_TABLES` order (children before parents), then upserts table by table in
 * `CATALOG_TABLES` order, then `/admin/catalog/finish` with the work database's version and sync time. Each request is
 * retried on network errors, 429 and 5xx; the first failure that can't be retried rejects.
 * Batches are small (`batchFor`) and each is followed by a rest (`pauseAfter`), so the users'
 * requests sharing the portal's Durable Object never wait long behind the upload.
 */
export async function uploadCatalog(
  opts: UploadOptions
): Promise<{ upserted: number; deleted: number }> {
  const fetchFn = opts.fetch ?? fetch
  const pace = opts.pace ?? DEFAULT_PACE
  const rest = opts.sleep ?? sleep
  const now = opts.now ?? Date.now
  const root = opts.url.replace(/\/+$/, '')

  const post = (path: string, body: unknown): Promise<void> =>
    withRetry(path, async () => {
      const res = await fetchFn(`${root}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new HttpError(res.status, `${path} failed: HTTP ${res.status} ${text}`.trim())
      }
    })

  /** Posts one batch, then rests in proportion to how long the portal took over it. */
  const postBatch = async (path: string, body: unknown): Promise<void> => {
    const started = now()
    await post(path, body)
    const ms = pauseAfter(now() - started, pace)
    if (ms > 0) await rest(ms)
  }

  const diffs = CATALOG_TABLES.map((t) => ({ t, ...diffTable(opts.work, opts.base, t) }))
  let upserted = 0
  let deleted = 0
  // Deletes go first so a freed unique value (e.g. a logo's image_key) is gone before its new row lands.
  for (const { t, deletes } of [...diffs].reverse()) {
    for (const keys of chunk(deletes, batchFor(t.name, opts.batch))) {
      await postBatch('/admin/catalog/delete', { table: t.name, keys })
      deleted += keys.length
    }
  }
  for (const { t, upserts } of diffs) {
    for (const rows of chunk(upserts, batchFor(t.name, opts.batch))) {
      await postBatch('/admin/catalog/rows', { table: t.name, rows })
      upserted += rows.length
    }
  }

  const meta: Record<string, string> = {}
  const dbVersion = getMeta(opts.work, 'db_version')
  const lastSyncAt = getMeta(opts.work, 'last_sync_at')
  if (dbVersion !== null) meta.db_version = dbVersion
  if (lastSyncAt !== null) meta.last_sync_at = lastSyncAt
  await post('/admin/catalog/finish', { meta })
  return { upserted, deleted }
}
