import type { SqlDb } from '../../../src/main/db/sql'
import { getMeta } from '../../../src/main/db/meta'
import { CollectionError } from '../../../src/main/repo/collection'
import { CATALOG_TABLES } from '../../../src/shared/catalogTables'
import {
  MAX_CHANGES,
  type CatalogChange,
  type CatalogChangesResponse,
  type CatalogTableName
} from '../../../src/shared/catalogFeed'
import type { AppDeps } from './app'
import { currentUser } from './auth'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Columns selected for the feed; printings also expose the server id, generated pkey and provenance. */
const FEED_COLUMNS = new Map(
  CATALOG_TABLES.map((t) => [
    t.name,
    (t.name === 'card_printings' ? ['id', 'pkey', ...t.columns, 'contributed'] : t.columns)
      .map((c) => `"${c}"`)
      .join(', ')
  ])
)

/**
 * Rows changed after `since` from every catalog table, plus (only when `since > 0`) deletions,
 * merged by seq. At most `limit` come back; `more` says there are further changes after `cursor`.
 */
export function catalogChanges(db: SqlDb, since: number, limit: number): CatalogChangesResponse {
  const merged: CatalogChange[] = []
  for (const t of CATALOG_TABLES) {
    const rows = db
      .prepare(
        `SELECT catalog_seq AS seq, ${FEED_COLUMNS.get(t.name)} FROM ${t.name}
         WHERE catalog_seq > ? ORDER BY catalog_seq LIMIT ?`
      )
      .all(since, limit + 1) as ({ seq: number } & Record<string, string | number | null>)[]
    for (const { seq, ...row } of rows)
      merged.push({ seq, table: t.name as CatalogTableName, row })
  }
  if (since > 0) {
    const dead = db
      .prepare('SELECT seq, tbl, key FROM catalog_tombstones WHERE seq > ? ORDER BY seq LIMIT ?')
      .all(since, limit + 1) as { seq: number; tbl: string; key: string }[]
    for (const d of dead)
      merged.push({
        seq: d.seq,
        table: d.tbl as CatalogTableName,
        deleted: JSON.parse(d.key) as (string | number | null)[]
      })
  }
  merged.sort((a, b) => a.seq - b.seq)
  const changes = merged.slice(0, limit)
  return {
    changes,
    cursor: changes.length ? changes[changes.length - 1].seq : since,
    more: merged.length > limit,
    dbVersion: getMeta(db, 'db_version')
  }
}

function wholeNumber(raw: string | null, what: string, min: number): number {
  const n = raw !== null && /^\d{1,16}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(n) || n < min)
    throw new CollectionError(`${what} must be a whole number of at least ${min}`)
  return n
}

export async function catalogRoute(req: Request, deps: AppDeps, path: string): Promise<Response> {
  if (path !== 'changes') return json({ error: 'Not found' }, 404)
  if (req.method !== 'GET') return json({ error: 'method-not-allowed' }, 405)
  const user = await currentUser(req, deps)
  if (!user || user.kind !== 'desktop') return json({ error: 'signed-out' }, 401)

  try {
    const q = new URL(req.url).searchParams
    const since = wholeNumber(q.get('since'), 'since', 0)
    const limit = q.has('limit')
      ? Math.min(wholeNumber(q.get('limit'), 'limit', 1), MAX_CHANGES)
      : MAX_CHANGES
    return json(catalogChanges(deps.db, since, limit))
  } catch (e) {
    if (e instanceof CollectionError) return json({ error: e.message }, 400)
    throw e
  }
}
