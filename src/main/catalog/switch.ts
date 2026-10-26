import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type Database from 'better-sqlite3'
import type { SqlDb } from '../db/sql'
import { deleteMeta, getMeta, setMeta } from '../db/meta'
import { CloudAuthError, CloudOfflineError, type CloudClient } from '../cloud/client'
import { CATALOG_TABLES } from '../../shared/catalogTables'
import type { CatalogChange } from '../../shared/catalogFeed'
import { applyChanges, finishApply, type ApplyResult } from './apply'

export type SwitchOutcome = { state: 'done' } | { state: 'pending'; reason: string }

export interface SwitchFailure {
  reason: string
  at: string
  retry: 'next-run' | 'next-launch'
}

export interface SwitchDeps {
  client: CloudClient
  backupPath: string
  now: () => Date
  onProgress?: (phase: 'downloading' | 'saving') => void
  /** Test seam: runs inside the apply transaction, just before the census after. */
  afterApply?: (db: SqlDb) => void
}

export const CENSUS_MISMATCH = "Your collection didn't match after updating card data"
export const BACKUP_FAILED = "Couldn't back up your collection"
const OFFLINE = "Couldn't reach the server to download card data"

/** Side tables the switch makes match the server; cards and card_images are never pruned. */
const PRUNED_TABLES = [
  'sets',
  'pack_art',
  'set_logos',
  'konami_logos',
  'tcgplayer_groups',
  'tcgplayer_products'
]
/** Staged changes applied per batch, so a whole snapshot is never held in memory at once. */
const APPLY_BATCH = 5000

class CensusMismatchError extends Error {}

type Triple = [pkey: string | null, imageId: number, quantity: number]

const compareTriples = (a: Triple, b: Triple): number => {
  const pa = a[0] ?? ''
  const pb = b[0] ?? ''
  if (pa !== pb) return pa < pb ? -1 : 1
  return a[1] - b[1] || a[2] - b[2]
}

/**
 * A canonical description of every owner's live collection: a JSON array, one element per owner
 * that has live entries, sorted by owner id:
 *
 *   [{ "owner": 0, "entries": 3, "quantity": 6, "items": [[pkey, image_id, quantity], ...] }, ...]
 *
 * `items` is sorted by pkey (plain code-unit order), then image_id, then quantity. An entry whose
 * printing row is missing shows a null pkey. Two databases holding the same cards give the same
 * string whatever their row ids or row order.
 */
export function collectionCensus(db: SqlDb): string {
  const rows = db
    .prepare(
      `SELECT e.owner_id AS owner, p.pkey AS pkey, e.image_id AS image, e.quantity AS quantity
       FROM collection_entries e LEFT JOIN card_printings p ON p.id = e.printing_id
       WHERE e.deleted_at IS NULL`
    )
    .all() as { owner: number; pkey: string | null; image: number; quantity: number }[]
  const owners = new Map<number, Triple[]>()
  for (const r of rows) {
    let list = owners.get(r.owner)
    if (!list) owners.set(r.owner, (list = []))
    list.push([r.pkey, r.image, r.quantity])
  }
  const census = [...owners.entries()]
    .sort(([a], [b]) => a - b)
    .map(([owner, items]) => ({
      owner,
      entries: items.length,
      quantity: items.reduce((sum, t) => sum + t[2], 0),
      items: items.sort(compareTriples)
    }))
  return JSON.stringify(census)
}

/** Ids of entries of any kind (live or tombstoned) whose printing or image row is gone. */
const danglingEntries = (db: SqlDb): Set<number> =>
  new Set(
    (
      db
        .prepare(
          `SELECT e.id AS id FROM collection_entries e
           WHERE NOT EXISTS (SELECT 1 FROM card_printings p WHERE p.id = e.printing_id)
              OR NOT EXISTS (SELECT 1 FROM card_images i WHERE i.image_id = e.image_id)`
        )
        .all() as { id: number }[]
    ).map((r) => r.id)
  )

function recordFailure(
  db: SqlDb,
  deps: SwitchDeps,
  reason: string,
  retry: SwitchFailure['retry']
): SwitchOutcome {
  const failure: SwitchFailure = { reason, at: deps.now().toISOString(), retry }
  setMeta(db, 'catalog_switch_failed', JSON.stringify(failure))
  return { state: 'pending', reason }
}

/**
 * The one-time move from this desktop's self-built catalog to the server's. Downloads the full
 * snapshot into `catalog_staging` (resumable page by page), backs the database up, then in one
 * transaction applies the snapshot and prunes what the server doesn't have, keeping every row a
 * collection entry uses. The transaction commits only if every owner's live collection reads the
 * same before and after (by pkey) and no entry newly lost its printing or image.
 */
export async function runSwitch(raw: Database.Database, deps: SwitchDeps): Promise<SwitchOutcome> {
  const db: SqlDb = raw
  if (getMeta(db, 'catalog_switched_at') !== null) return { state: 'done' }

  // 1. Download the snapshot into staging; each page and its cursor commit together.
  deps.onProgress?.('downloading')
  let cursor = Number(getMeta(db, 'catalog_staging_cursor') ?? 0)
  let dbVersion: string | null = null
  const stage = db.prepare(
    'INSERT OR REPLACE INTO catalog_staging (seq, tbl, row) VALUES (?, ?, ?)'
  )
  try {
    for (;;) {
      const page = await deps.client.catalogChanges(cursor)
      if (page.more && page.cursor <= cursor) throw new Error('The catalog feed stopped advancing')
      db.transaction(() => {
        for (const c of page.changes) stage.run(c.seq, c.table, JSON.stringify(c))
        setMeta(db, 'catalog_staging_cursor', String(page.cursor))
      })()
      cursor = page.cursor
      dbVersion = page.dbVersion
      if (!page.more) break
    }
  } catch (e) {
    if (e instanceof CloudAuthError) throw e
    console.warn('Catalog switch: download stopped', e)
    return recordFailure(
      db,
      deps,
      e instanceof CloudOfflineError ? OFFLINE : (e as Error).message || OFFLINE,
      'next-run'
    )
  }

  // 2. Back up once, before anything in the catalog changes.
  const recorded = getMeta(db, 'catalog_switch_backup')
  if (recorded === null || !existsSync(recorded)) {
    try {
      mkdirSync(dirname(deps.backupPath), { recursive: true })
      await raw.backup(deps.backupPath)
    } catch (e) {
      console.warn('Catalog switch: backup failed', e)
      return recordFailure(db, deps, BACKUP_FAILED, 'next-run')
    }
    setMeta(db, 'catalog_switch_backup', deps.backupPath)
  }

  // 3. Apply, prune and check, all or nothing.
  deps.onProgress?.('saving')
  try {
    db.transaction(() => {
      const before = collectionCensus(db)
      // Entries already dangling in an old database stay as they are and never block the switch;
      // only a reference this switch breaks fails it.
      const danglingBefore = danglingEntries(db)
      const result = applyStaged(db)
      pruneUnlisted(db)
      finishApply(db, result)
      deps.afterApply?.(db)
      const after = collectionCensus(db)
      const broken = [...danglingEntries(db)].filter((id) => !danglingBefore.has(id))
      if (after !== before || broken.length > 0) {
        console.warn(
          `Catalog switch: census differs (entries newly without a printing or image: ${broken.join(', ') || 'none'})`
        )
        console.warn(`Catalog switch: census before: ${before}`)
        console.warn(`Catalog switch: census after: ${after}`)
        throw new CensusMismatchError(CENSUS_MISMATCH)
      }
      const at = deps.now().toISOString()
      setMeta(db, 'catalog_cursor', getMeta(db, 'catalog_staging_cursor') ?? String(cursor))
      setMeta(db, 'catalog_switched_at', at)
      setMeta(db, 'last_sync_at', at)
      if (dbVersion !== null) setMeta(db, 'db_version', dbVersion)
      db.exec('DELETE FROM catalog_staging')
      deleteMeta(db, 'catalog_staging_cursor')
      deleteMeta(db, 'catalog_switch_failed')
    })()
  } catch (e) {
    if (e instanceof CensusMismatchError)
      return recordFailure(db, deps, CENSUS_MISMATCH, 'next-launch')
    console.warn('Catalog switch: applying card data failed', e)
    return recordFailure(
      db,
      deps,
      `Couldn't update card data: ${(e as Error).message}`,
      'next-launch'
    )
  }
  return { state: 'done' }
}

/** Applies every staged change in seq order, in batches. Must run inside a transaction. */
function applyStaged(db: SqlDb): ApplyResult {
  const total: ApplyResult = { applied: 0, cardsChanged: false, imagesChanged: false }
  const page = db.prepare('SELECT seq, row FROM catalog_staging WHERE seq > ? ORDER BY seq LIMIT ?')
  let after = -1
  for (;;) {
    const rows = page.all(after, APPLY_BATCH) as { seq: number; row: string }[]
    if (rows.length === 0) break
    const r = applyChanges(
      db,
      rows.map((x) => JSON.parse(x.row) as CatalogChange)
    )
    total.applied += r.applied
    total.cardsChanged ||= r.cardsChanged
    total.imagesChanged ||= r.imagesChanged
    after = rows[rows.length - 1].seq
  }
  return total
}

/**
 * Removes what the server's catalog doesn't list. Printings the snapshot didn't name (no
 * `remote_id`) are deleted unless an entry of any owner, live or tombstoned, uses them; those are
 * kept and flagged `missing_from_api`. Side-table rows whose key no staged row carries are deleted;
 * no table holds a foreign key to these side tables (see schema.ts), so no entry can depend on them.
 */
function pruneUnlisted(db: SqlDb): void {
  db.exec(
    `UPDATE card_printings SET missing_from_api = 1
     WHERE remote_id IS NULL AND EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = card_printings.id)`
  )
  db.exec(
    `DELETE FROM card_printings
     WHERE remote_id IS NULL AND NOT EXISTS (SELECT 1 FROM collection_entries e WHERE e.printing_id = card_printings.id)`
  )
  for (const name of PRUNED_TABLES) {
    const table = CATALOG_TABLES.find((t) => t.name === name)
    if (!table) continue
    const keyOf = (row: Record<string, unknown>): string =>
      JSON.stringify(table.key.map((k) => row[k] ?? null))
    const listed = new Set<string>()
    for (const { row } of db.prepare('SELECT row FROM catalog_staging WHERE tbl = ?').all(name) as {
      row: string
    }[]) {
      const change = JSON.parse(row) as CatalogChange
      if ('row' in change) listed.add(keyOf(change.row))
    }
    const cols = table.key.map((k) => `"${k}"`).join(', ')
    const where = table.key.map((k) => `"${k}" IS ?`).join(' AND ')
    const drop = db.prepare(`DELETE FROM ${name} WHERE ${where}`)
    for (const local of db.prepare(`SELECT ${cols} FROM ${name}`).all() as Record<
      string,
      unknown
    >[]) {
      if (!listed.has(keyOf(local))) drop.run(...table.key.map((k) => local[k]))
    }
  }
}
