import type { SqlDb } from '../../../src/main/db/sql'
import { getMeta } from '../../../src/main/db/meta'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  CATALOG_TABLES,
  LEGACY_CATALOG_TABLES,
  type CatalogTable
} from '../../../src/shared/catalogTables'
import type { GameId } from '../../../src/shared/games'
import {
  MAX_CHANGES,
  MAX_CONTRIBUTE,
  type CatalogChange,
  type CatalogChangesResponse,
  type CatalogTableName
} from '../../../src/shared/catalogFeed'
import type { AppDeps } from './app'
import { currentUser, gamesFor } from './auth'
import { contributePrintings } from './contribute'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The feed's columns per table; printings also expose the server id, generated pkey and provenance. */
const feedColumns = (tables: readonly CatalogTable[]): Map<string, string> =>
  new Map(
    tables.map((t) => [
      t.name,
      (t.name === 'card_printings' ? ['id', 'pkey', ...t.columns, 'contributed'] : t.columns)
        .map((c) => `"${c}"`)
        .join(', ')
    ])
  )
const LEGACY_COLUMNS = feedColumns(LEGACY_CATALOG_TABLES)
const GAME_COLUMNS = feedColumns(CATALOG_TABLES)
/** Tables with a `game` column, and so a `(game, catalog_seq)` index. */
const HAS_GAME = new Set(
  CATALOG_TABLES.filter((t) => t.columns.includes('game')).map((t) => t.name)
)

/**
 * Rows changed after `since` from every catalog table, plus (only when `since > 0`) deletions,
 * merged by seq. At most `limit` come back; `more` says there are further changes after `cursor`.
 *
 * With a `game`: the tables that game has rows in, only its rows and tombstones, with today's
 * columns and keys. Without one (the legacy feed old clients ask for): exactly the feed from before
 * games, Yu-Gi-Oh! only, with the frozen legacy columns and `sets` tombstones keyed
 * `[language, set_name]`.
 */
export function catalogChanges(
  db: SqlDb,
  since: number,
  limit: number,
  tables?: readonly CatalogTableName[],
  game?: GameId
): CatalogChangesResponse {
  const of = game ?? 'ygo'
  const wanted = (game ? CATALOG_TABLES : LEGACY_CATALOG_TABLES).filter(
    (t) => t.games.includes(of) && (!tables || tables.includes(t.name as CatalogTableName))
  )
  const columns = game ? GAME_COLUMNS : LEGACY_COLUMNS
  const marks = wanted.map(() => '?').join(', ')
  const names = wanted.map((t) => t.name)
  const gameIs = (t: string): string => (HAS_GAME.has(t) ? 'game = ? AND ' : '')
  const gameArg = (t: string): string[] => (HAS_GAME.has(t) ? [of] : [])
  // Find the page's last seq with index-only queries so full rows are read at most `limit` times.
  // Seqs come from one global clock, so they are unique across tables. Tombstones are left out
  // of a from-scratch snapshot (since = 0). One query per table, not a UNION: Durable Object
  // SQLite caps the terms in a compound SELECT. Each query stops below the smallest `limit + 1`
  // seqs found so far, so tables whose seqs sit past the page read almost nothing. A table with a
  // game reads its (game, catalog_seq) index.
  let first: number[] = []
  const take = (seqs: { seq: number }[]): void => {
    first = [...first, ...seqs.map((r) => r.seq)].sort((a, b) => a - b).slice(0, limit + 1)
  }
  for (const t of names) {
    const full = first.length > limit
    take(
      db
        .prepare(
          `SELECT catalog_seq AS seq FROM ${t}
           WHERE ${gameIs(t)}catalog_seq > ?${full ? ' AND catalog_seq < ?' : ''}
           ORDER BY catalog_seq LIMIT ?`
        )
        .all(...gameArg(t), ...(full ? [since, first[limit]] : [since]), limit + 1) as {
        seq: number
      }[]
    )
  }
  const tombstones = since > 0 && wanted.length > 0
  const inTables = tables ? ` AND tbl IN (${marks})` : ''
  const tableArgs = tables ? names : []
  if (tombstones) {
    const full = first.length > limit
    take(
      db
        .prepare(
          `SELECT seq FROM catalog_tombstones
           WHERE seq > ?${full ? ' AND seq < ?' : ''} AND game = ?${inTables}
           ORDER BY seq LIMIT ?`
        )
        .all(...(full ? [since, first[limit]] : [since]), of, ...tableArgs, limit + 1) as {
        seq: number
      }[]
    )
  }
  // Fewer than `limit` seqs: everything after `since` fits on this page.
  const cutoff = first.length >= limit ? first[limit - 1] : Number.MAX_SAFE_INTEGER
  const more = first.length > limit

  const changes: CatalogChange[] = []
  for (const t of names) {
    const rows = db
      .prepare(
        `SELECT catalog_seq AS seq, ${columns.get(t)} FROM ${t}
         WHERE ${gameIs(t)}catalog_seq > ? AND catalog_seq <= ?`
      )
      .all(...gameArg(t), since, cutoff) as ({ seq: number } & Record<
      string,
      string | number | null
    >)[]
    for (const { seq, ...row } of rows) changes.push({ seq, table: t as CatalogTableName, row })
  }
  if (tombstones) {
    const dead = db
      .prepare(
        `SELECT seq, tbl, key FROM catalog_tombstones WHERE seq > ? AND seq <= ? AND game = ?${inTables}`
      )
      .all(since, cutoff, of, ...tableArgs) as { seq: number; tbl: string; key: string }[]
    for (const d of dead) {
      const key = JSON.parse(d.key) as (string | number | null)[]
      changes.push({
        seq: d.seq,
        table: d.tbl as CatalogTableName,
        deleted: feedKey(d.tbl, key, game)
      })
    }
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

/**
 * A tombstone's key as the feed sends it. Since server-12 a `sets` tombstone keys on
 * [game, language, set_name], and one from before on [language, set_name] (always Yu-Gi-Oh!): the
 * legacy feed sends the two-part key, a per-game feed the three-part one.
 */
function feedKey(
  table: string,
  key: (string | number | null)[],
  game: GameId | undefined
): (string | number | null)[] {
  if (table !== 'sets') return key
  if (!game) return key.length === 3 ? key.slice(1) : key
  return key.length === 2 ? ['ygo', ...key] : key
}

function wholeNumber(raw: string | null, what: string, min: number): number {
  const n = raw !== null && /^\d{1,16}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(n) || n < min)
    throw new CollectionError(`${what} must be a whole number of at least ${min}`)
  return n
}

/** The `tables` parameter: legacy table names, or with a game any of today's. */
function tablesParam(raw: string | null, game: GameId | undefined): CatalogTableName[] | undefined {
  if (raw === null) return undefined
  const known = new Set<string>((game ? CATALOG_TABLES : LEGACY_CATALOG_TABLES).map((t) => t.name))
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
      contributePrintings(deps.db, user.id, rows, deps.now(), gamesFor(deps, user.id))
    )()
    return json({ results })
  }

  const q = new URL(req.url).searchParams
  // No `game` is the legacy feed; a game must be one of the user's, as on sync and RPC.
  const asked = q.get('game')
  const game = asked === null ? undefined : gamesFor(deps, user.id).find((g) => g === asked)
  if (asked !== null && !game) return json({ error: 'game-not-allowed' }, 403)

  try {
    const since = wholeNumber(q.get('since'), 'since', 0)
    const limit = q.has('limit')
      ? Math.min(wholeNumber(q.get('limit'), 'limit', 1), MAX_CHANGES)
      : MAX_CHANGES
    return json(catalogChanges(deps.db, since, limit, tablesParam(q.get('tables'), game), game))
  } catch (e) {
    if (e instanceof CollectionError) return json({ error: e.message }, 400)
    throw e
  }
}
