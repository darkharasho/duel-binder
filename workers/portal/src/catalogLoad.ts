import { CATALOG_TABLES, type CatalogTable } from '../../../src/shared/catalogTables'
import { setMeta, type MetaKey } from '../../../src/main/db/meta'
import type { AppDeps } from './app'
import { upsertCatalogRow } from '../../../src/main/catalog/upsert'
import { putFingerprints, rollbackFingerprints } from './scanFiles'
import { collectStats } from './stats'

const MAX_ITEMS = 5000
const META_KEYS: MetaKey[] = ['db_version', 'last_sync_at']

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

class BadRequest extends Error {}

const digest = async (s: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))

/** Constant-time: compares fixed-length digests so neither content nor length leaks. */
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function authorized(req: Request, deps: AppDeps): Promise<boolean> {
  const expected = deps.env.ADMIN_TOKEN
  if (!expected) return false
  const m = /^Bearer (.*)$/.exec(req.headers.get('authorization') ?? '')
  if (!m) return false
  return tokenMatches(m[1], expected)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isScalar = (v: unknown): v is string | number | null =>
  v === null || typeof v === 'string' || typeof v === 'number'

function tableOf(body: Record<string, unknown>): CatalogTable {
  const table = CATALOG_TABLES.find((t) => t.name === body.table)
  if (!table) throw new BadRequest('Unknown table')
  return table
}

function listOf(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new BadRequest(`${what} must be an array`)
  if (v.length > MAX_ITEMS) throw new BadRequest(`At most ${MAX_ITEMS} ${what} per request`)
  return v
}

function validateRow(table: CatalogTable, row: unknown): Record<string, string | number | null> {
  if (!isObject(row)) throw new BadRequest('Each row must be an object')
  const out: Record<string, string | number | null> = {}
  for (const [k, v] of Object.entries(row)) {
    if (!table.columns.includes(k)) throw new BadRequest(`Unknown column ${k}`)
    if (!isScalar(v)) throw new BadRequest(`Column ${k} must be a string, number or null`)
    out[k] = v
  }
  const required =
    table.name === 'card_printings'
      ? ['language', 'card_id', 'set_name', 'set_code', 'set_rarity']
      : table.key
  for (const k of required) {
    if (out[k] === undefined || out[k] === null) throw new BadRequest(`Missing key column ${k}`)
  }
  return out
}

function upsertRows(deps: AppDeps, table: CatalogTable, rows: unknown[]): void {
  const { db } = deps
  const valid = rows.map((r) => validateRow(table, r))
  // A source upsert makes a contributed printing an ordinary catalog row again, and un-flags a
  // printing the source lists again.
  const extra = table.name === 'card_printings' ? { contributed: 0 } : undefined
  db.transaction(() => {
    for (const row of valid) upsertCatalogRow(db, table, row, extra, { clearMissing: true })
  })()
}

function deleteKeys(deps: AppDeps, table: CatalogTable, keys: unknown[]): void {
  const { db } = deps
  for (const k of keys) {
    if (!Array.isArray(k) || k.length !== table.key.length || !k.every(isScalar)) {
      throw new BadRequest('Each key must be an array matching the table key')
    }
  }
  if (table.name === 'cards' || table.name === 'card_images') return
  const tuples = keys as (string | number | null)[][]
  db.transaction(() => {
    for (const k of tuples) {
      if (table.name === 'card_printings') {
        const owned = 'id IN (SELECT printing_id FROM collection_entries)'
        // Contributed printings never came from the source, so its deletions don't apply to them.
        db.prepare(
          `UPDATE card_printings SET missing_from_api = 1 WHERE pkey = ? AND contributed = 0 AND ${owned}`
        ).run(k[0])
        db.prepare(
          `DELETE FROM card_printings WHERE pkey = ? AND contributed = 0 AND NOT (${owned})`
        ).run(k[0])
      } else {
        const where = table.key.map((c) => `"${c}" = ?`).join(' AND ')
        db.prepare(`DELETE FROM ${table.name} WHERE ${where}`).run(...k)
      }
    }
  })()
}

function finish(deps: AppDeps, body: Record<string, unknown>): void {
  const meta = body.meta
  if (!isObject(meta)) throw new BadRequest('meta must be an object')
  for (const [k, v] of Object.entries(meta)) {
    if (!META_KEYS.includes(k as MetaKey)) throw new BadRequest(`Unknown meta key ${k}`)
    if (typeof v !== 'string') throw new BadRequest(`meta.${k} must be a string`)
  }
  deps.db.transaction(() => {
    deps.db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
    for (const [k, v] of Object.entries(meta)) setMeta(deps.db, k as MetaKey, v as string)
  })()
}

/** Handles every `/admin/*` request. */
export async function adminRoute(req: Request, deps: AppDeps): Promise<Response> {
  if (!(await authorized(req, deps))) return json({ error: 'Unauthorized' }, 401)
  const path = new URL(req.url).pathname

  if (req.method === 'GET' && path === '/admin/catalog/status') {
    const counts: Record<string, number> = {}
    for (const t of CATALOG_TABLES) {
      counts[t.name] = (
        deps.db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get() as { n: number }
      ).n
    }
    return json({ counts })
  }

  if (req.method === 'GET' && path === '/admin/stats') return json(collectStats(deps))

  if (req.method === 'GET' && path === '/admin/catalog/pkeys') {
    const q = new URL(req.url).searchParams
    const asked = Number(q.get('limit') ?? MAX_ITEMS)
    const limit = Math.min(MAX_ITEMS, Number.isInteger(asked) && asked > 0 ? asked : MAX_ITEMS)
    const rows = deps.db
      .prepare('SELECT pkey FROM card_printings WHERE pkey > ? ORDER BY pkey LIMIT ?')
      .all(q.get('after') ?? '', limit + 1) as { pkey: string }[]
    return json({ pkeys: rows.slice(0, limit).map((r) => r.pkey), more: rows.length > limit })
  }

  if (req.method === 'PUT' && path === '/admin/scan/fingerprints') return putFingerprints(req, deps)
  if (req.method === 'POST' && path === '/admin/scan/fingerprints/rollback') {
    return rollbackFingerprints(deps)
  }

  const handlers: Record<string, (body: Record<string, unknown>) => void> = {
    '/admin/catalog/rows': (b) => upsertRows(deps, tableOf(b), listOf(b.rows, 'rows')),
    '/admin/catalog/delete': (b) => deleteKeys(deps, tableOf(b), listOf(b.keys, 'keys')),
    '/admin/catalog/finish': (b) => finish(deps, b)
  }
  const handler = req.method === 'POST' ? handlers[path] : undefined
  if (!handler) return json({ error: 'Not found' }, 404)
  try {
    const body: unknown = await req.json().catch(() => null)
    if (!isObject(body)) throw new BadRequest('Body must be a JSON object')
    handler(body)
    return json({ ok: true })
  } catch (e) {
    if (e instanceof BadRequest) return json({ error: e.message }, 400)
    throw e
  }
}
