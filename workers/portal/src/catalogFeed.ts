import type { SqlDb } from '../../../src/main/db/sql'
import { getMeta } from '../../../src/main/db/meta'
import { CollectionError } from '../../../src/main/repo/collection'
import { CATALOG_TABLES } from '../../../src/shared/catalogTables'
import {
  MAX_CHANGES,
  MAX_CONTRIBUTE,
  type CatalogChange,
  type CatalogChangesResponse,
  type CatalogTableName
} from '../../../src/shared/catalogFeed'
import type { AppDeps } from './app'
import { currentUser } from './auth'
import { contributePrintings } from './contribute'

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
export function catalogChanges(
  db: SqlDb,
  since: number,
  limit: number,
  tables?: readonly CatalogTableName[]
): CatalogChangesResponse {
  const wanted = CATALOG_TABLES.filter(
    (t) => !tables || tables.includes(t.name as CatalogTableName)
  )
  const marks = wanted.map(() => '?').join(', ')
  // Find the page's last seq with index-only queries so full rows are read at most `limit` times.
  // Seqs come from one global clock, so they are unique across tables. Tombstones are left out
  // of a from-scratch snapshot (since = 0). One query per table, not a UNION: Durable Object
  // SQLite caps the terms in a compound SELECT. Each query stops below the smallest `limit + 1`
  // seqs found so far, so tables whose seqs sit past the page read almost nothing.
  const sources = wanted.map((t) => [t.name, 'catalog_seq'])
  if (since > 0) sources.push(['catalog_tombstones', 'seq'])
  let first: number[] = []
  for (const [table, col] of sources) {
    const full = first.length > limit
    const inTables = table === 'catalog_tombstones' && tables ? ` AND tbl IN (${marks})` : ''
    const seqs = db
      .prepare(
        `SELECT ${col} AS seq FROM ${table} WHERE ${col} > ?${full ? ` AND ${col} < ?` : ''}${inTables}
         ORDER BY ${col} LIMIT ?`
      )
      .all(
        ...(full ? [since, first[limit]] : [since]),
        ...(inTables ? wanted.map((t) => t.name) : []),
        limit + 1
      ) as { seq: number }[]
    first = [...first, ...seqs.map((r) => r.seq)].sort((a, b) => a - b).slice(0, limit + 1)
  }
  // Fewer than `limit` seqs: everything after `since` fits on this page.
  const cutoff = first.length >= limit ? first[limit - 1] : Number.MAX_SAFE_INTEGER
  const more = first.length > limit

  const changes: CatalogChange[] = []
  for (const t of wanted) {
    const rows = db
      .prepare(
        `SELECT catalog_seq AS seq, ${FEED_COLUMNS.get(t.name)} FROM ${t.name}
         WHERE catalog_seq > ? AND catalog_seq <= ?`
      )
      .all(since, cutoff) as ({ seq: number } & Record<string, string | number | null>)[]
    for (const { seq, ...row } of rows)
      changes.push({ seq, table: t.name as CatalogTableName, row })
  }
  if (since > 0) {
    const dead = db
      .prepare(
        `SELECT seq, tbl, key FROM catalog_tombstones WHERE seq > ? AND seq <= ?${
          tables ? ` AND tbl IN (${marks})` : ''
        }`
      )
      .all(since, cutoff, ...(tables ? wanted.map((t) => t.name) : [])) as {
      seq: number
      tbl: string
      key: string
    }[]
    for (const d of dead)
      changes.push({
        seq: d.seq,
        table: d.tbl as CatalogTableName,
        deleted: JSON.parse(d.key) as (string | number | null)[]
      })
  }
  changes.sort((a, b) => a.seq - b.seq)
  return {
    changes,
    cursor: changes.length ? changes[changes.length - 1].seq : since,
    more,
    dbVersion: getMeta(db, 'db_version'),
    latest: (db.prepare('SELECT seq FROM catalog_clock WHERE id = 1').get() as { seq: number }).seq
  }
}

function wholeNumber(raw: string | null, what: string, min: number): number {
  const n = raw !== null && /^\d{1,16}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(n) || n < min)
    throw new CollectionError(`${what} must be a whole number of at least ${min}`)
  return n
}

function tablesParam(raw: string | null): CatalogTableName[] | undefined {
  if (raw === null) return undefined
  const known = new Set<string>(CATALOG_TABLES.map((t) => t.name))
  const names = raw.split(',')
  for (const n of names) {
    if (!known.has(n)) throw new CollectionError(`tables has an unknown or empty name: "${n}"`)
  }
  if (new Set(names).size !== names.length)
    throw new CollectionError('tables must not repeat a name')
  return names as CatalogTableName[]
}

export async function catalogRoute(req: Request, deps: AppDeps, path: string): Promise<Response> {
  if (path !== 'changes' && path !== 'contribute') return json({ error: 'Not found' }, 404)
  if (req.method !== (path === 'changes' ? 'GET' : 'POST'))
    return json({ error: 'method-not-allowed' }, 405)
  const user = await currentUser(req, deps)
  if (!user || user.kind !== 'desktop') return json({ error: 'signed-out' }, 401)

  if (path === 'contribute') {
    const body = (await req.json().catch(() => null)) as { printings?: unknown } | null
    if (!body || !Array.isArray(body.printings)) return json({ error: 'bad-request' }, 400)
    if (body.printings.length > MAX_CONTRIBUTE) return json({ error: 'too-many' }, 413)
    const rows = body.printings
    const results = deps.db.transaction(() =>
      contributePrintings(deps.db, user.id, rows, deps.now())
    )()
    return json({ results })
  }

  try {
    const q = new URL(req.url).searchParams
    const since = wholeNumber(q.get('since'), 'since', 0)
    const limit = q.has('limit')
      ? Math.min(wholeNumber(q.get('limit'), 'limit', 1), MAX_CHANGES)
      : MAX_CHANGES
    return json(catalogChanges(deps.db, since, limit, tablesParam(q.get('tables'))))
  } catch (e) {
    if (e instanceof CollectionError) return json({ error: e.message }, 400)
    throw e
  }
}
