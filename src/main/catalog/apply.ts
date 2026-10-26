import type { SqlDb } from '../db/sql'
import { CATALOG_TABLES } from '../../shared/catalogTables'
import type { CatalogChange } from '../../shared/catalogFeed'
import { upsertCatalogRow, type Scalar } from './upsert'

export interface ApplyResult {
  applied: number
  cardsChanged: boolean
  imagesChanged: boolean
}

/**
 * Applies feed changes in the order given. The caller owns the transaction. Nothing here may
 * lose or re-point a collection entry: a tombstone for a row an entry (any owner, live or
 * tombstoned) still depends on is skipped, or for printings the row is kept and flagged
 * `missing_from_api`.
 *
 * Must run inside a transaction: it defers foreign-key checks to commit, because a snapshot
 * lists each row at its latest seq, so a printing or image can arrive before its (later
 * updated) card. A real violation still fails the commit.
 */
export function applyChanges(db: SqlDb, changes: CatalogChange[]): ApplyResult {
  db.exec('PRAGMA defer_foreign_keys = ON')
  const result: ApplyResult = { applied: 0, cardsChanged: false, imagesChanged: false }
  const columnCache = new Map<string, Set<string>>()
  const localColumns = (table: string): Set<string> => {
    let cols = columnCache.get(table)
    if (!cols) {
      const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      cols = new Set(info.map((c) => c.name))
      columnCache.set(table, cols)
    }
    return cols
  }
  const exists = (sql: string, ...params: Scalar[]): boolean => db.prepare(sql).get(...params) !== undefined

  for (const change of changes) {
    const table = CATALOG_TABLES.find((t) => t.name === change.table)
    if (!table) continue

    if ('row' in change) {
      const cols = localColumns(table.name)
      const row: Record<string, Scalar> = {}
      for (const [k, v] of Object.entries(change.row)) {
        if (!cols.has(k)) continue
        if (table.name === 'card_printings' && (k === 'id' || k === 'pkey')) continue
        row[k] = v
      }
      const extra: Record<string, Scalar> =
        table.name === 'card_printings'
          ? { remote_id: change.row.id ?? null, contributed: change.row.contributed ?? 0 }
          : {}
      upsertCatalogRow(db, table, row, extra)
      result.applied++
      if (table.name === 'cards') result.cardsChanged = true
      if (table.name === 'card_images') result.imagesChanged = true
      continue
    }

    const key = change.deleted
    if (table.name === 'card_printings') {
      const local = db.prepare('SELECT id FROM card_printings WHERE pkey = ?').get(key[0]) as
        | { id: number }
        | undefined
      if (!local) continue
      if (exists('SELECT 1 FROM collection_entries WHERE printing_id = ? LIMIT 1', local.id)) {
        db.prepare('UPDATE card_printings SET missing_from_api = 1 WHERE id = ?').run(local.id)
      } else {
        db.prepare('DELETE FROM card_printings WHERE id = ?').run(local.id)
      }
      result.applied++
      continue
    }
    if (table.name === 'card_images') {
      if (exists('SELECT 1 FROM collection_entries WHERE image_id = ? LIMIT 1', key[0])) continue
      if (db.prepare('DELETE FROM card_images WHERE image_id = ?').run(key[0]).changes > 0) {
        result.applied++
        result.imagesChanged = true
      }
      continue
    }
    if (table.name === 'cards') {
      const id = key[0]
      const used =
        exists(
          'SELECT 1 FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id WHERE p.card_id = ? LIMIT 1',
          id
        ) ||
        exists(
          'SELECT 1 FROM collection_entries e JOIN card_images i ON i.image_id = e.image_id WHERE i.card_id = ? LIMIT 1',
          id
        ) ||
        // a kept (flagged) printing or image still points at the card
        exists('SELECT 1 FROM card_printings WHERE card_id = ? LIMIT 1', id) ||
        exists('SELECT 1 FROM card_images WHERE card_id = ? LIMIT 1', id)
      if (used) continue
      if (db.prepare('DELETE FROM cards WHERE id = ?').run(id).changes > 0) {
        result.applied++
        result.cardsChanged = true
      }
      continue
    }
    const where = table.key.map((k) => `"${k}" IS ?`).join(' AND ')
    const n = db.prepare(`DELETE FROM ${table.name} WHERE ${where}`).run(...key).changes
    if (n > 0) result.applied++
  }
  return result
}

/** Rebuilds the external-content search index once cards changed. */
export function finishApply(db: SqlDb, r: ApplyResult): void {
  if (r.cardsChanged) db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
}
