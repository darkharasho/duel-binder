import type Database from 'better-sqlite3'
import { getMeta } from '../../src/main/db/meta'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import { diffTable } from './diff'

const DEFAULT_BATCH = 2000
/** Waits before each retry; a request is tried once plus once per entry. */
const RETRY_DELAYS_MS = [1000, 2000, 4000]

export interface UploadOptions {
  url: string
  token: string
  work: Database.Database
  base: Database.Database | null
  fetch?: typeof fetch
  batch?: number
}

class HttpError extends Error {
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Sends what changed in `work` since `base` to the portal's admin endpoints: upserts table by
 * table in `CATALOG_TABLES` order, then deletions in reverse order (children before parents),
 * then `/admin/catalog/finish` with the work database's version and sync time. Each request is
 * retried on network errors, 429 and 5xx; the first failure that can't be retried rejects.
 */
export async function uploadCatalog(
  opts: UploadOptions
): Promise<{ upserted: number; deleted: number }> {
  const fetchFn = opts.fetch ?? fetch
  const batch = opts.batch ?? DEFAULT_BATCH
  const root = opts.url.replace(/\/+$/, '')

  const post = async (path: string, body: unknown): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchFn(`${root}${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new HttpError(res.status, `${path} failed: HTTP ${res.status} ${text}`.trim())
        }
        return
      } catch (e) {
        if (attempt >= RETRY_DELAYS_MS.length || !retryable(e)) throw e
        console.warn(
          `${path} attempt ${attempt + 1} failed, retrying:`,
          e instanceof Error ? e.message : e
        )
        await sleep(RETRY_DELAYS_MS[attempt])
      }
    }
  }

  const diffs = CATALOG_TABLES.map((t) => ({ t, ...diffTable(opts.work, opts.base, t) }))
  let upserted = 0
  let deleted = 0
  for (const { t, upserts } of diffs) {
    for (const rows of chunk(upserts, batch)) {
      await post('/admin/catalog/rows', { table: t.name, rows })
      upserted += rows.length
    }
  }
  for (const { t, deletes } of [...diffs].reverse()) {
    for (const keys of chunk(deletes, batch)) {
      await post('/admin/catalog/delete', { table: t.name, keys })
      deleted += keys.length
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
