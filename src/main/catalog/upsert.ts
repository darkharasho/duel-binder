import type { SqlDb, SqlStatement } from '../db/sql'
import type { CatalogTable } from '../../shared/catalogTables'

// Imported by the portal Worker bundle: keep this file free of electron, node and better-sqlite3.

export type Scalar = string | number | null

/**
 * Same formula as the desktop V10 generated column `card_printings.pkey`. Numbers bind as
 * floats, so card_id is cast back to an integer before it is concatenated into the key.
 */
export const PKEY_SQL = `CASE WHEN ? = 'en' THEN 'en|' || CAST(? AS INTEGER) || '|' || ? || '|' || ?
  ELSE ? || '|' || CAST(? AS INTEGER) || '|' || ? || '|' || ? || '|' || ? END`

/** Columns every pkey is built from (English keys leave out set_name). */
const PKEY_COLUMNS = ['language', 'card_id', 'set_code', 'set_rarity']

const statementCache = new WeakMap<SqlDb, Map<string, SqlStatement>>()

/**
 * `db.prepare(sql)`, prepared once per database handle. Preparing per row is slow, and
 * better-sqlite3 statements hold native memory the garbage collector doesn't see, so a big apply
 * that prepares per row grows by gigabytes before anything is freed.
 */
export function prepared(db: SqlDb, sql: string): SqlStatement {
  let statements = statementCache.get(db)
  if (!statements) statementCache.set(db, (statements = new Map()))
  let statement = statements.get(sql)
  if (!statement) statements.set(sql, (statement = db.prepare(sql)))
  return statement
}

/** The SQL for one (table, column set), built once per database handle. */
interface RowSql {
  /** Printings: the UPDATE for a pkey match, and the columns it binds (then the row id). */
  update?: { sql: string; cols: string[] }
  insert: string
  /** Other tables: per UNIQUE column, the DELETE of another key's row holding the value. */
  dropHolders: { column: string; sql: string }[]
}

const rowSqlCache = new WeakMap<SqlDb, Map<string, RowSql>>()

function rowSql(db: SqlDb, table: CatalogTable, cols: string[], clearMissing: boolean): RowSql {
  let plans = rowSqlCache.get(db)
  if (!plans) rowSqlCache.set(db, (plans = new Map()))
  const key = `${table.name}\0${clearMissing ? 1 : 0}\0${cols.join('\0')}`
  let plan = plans.get(key)
  if (plan) return plan
  const quoted = cols.map((c) => `"${c}"`)
  const placeholders = cols.map(() => '?').join(', ')
  if (table.name === 'card_printings') {
    // A pkey match already holds these values, so leaving them out spares the index updates.
    const written = cols.filter(
      (x) => !PKEY_COLUMNS.includes(x) && !(clearMissing && x === 'missing_from_api')
    )
    const set = written.map((x) => `"${x}" = ?`)
    if (clearMissing) set.push('missing_from_api = 0')
    plan = {
      update:
        set.length > 0
          ? { sql: `UPDATE card_printings SET ${set.join(', ')} WHERE id = ?`, cols: written }
          : undefined,
      insert: `INSERT INTO card_printings (${quoted.join(', ')}) VALUES (${placeholders})`,
      dropHolders: []
    }
  } else {
    const otherKey = table.key.map((k) => `"${k}" IS NOT ?`).join(' OR ')
    const updates = cols
      .filter((c) => !table.key.includes(c))
      .map((c) => `"${c}" = excluded."${c}"`)
    // Since V19 the sets key includes the game; a legacy row (no game) is a Yu-Gi-Oh! one, which
    // the column default makes it, so it conflicts on the game too.
    const conflictKey =
      table.name === 'sets' && !table.key.includes('game') ? ['game', ...table.key] : table.key
    const conflict = conflictKey.map((k) => `"${k}"`).join(', ')
    plan = {
      insert:
        `INSERT INTO ${table.name} (${quoted.join(', ')}) VALUES (${placeholders}) ` +
        (updates.length > 0
          ? `ON CONFLICT(${conflict}) DO UPDATE SET ${updates.join(', ')}`
          : `ON CONFLICT(${conflict}) DO NOTHING`),
      dropHolders: (table.unique ?? []).map((u) => ({
        column: u,
        sql: `DELETE FROM ${table.name} WHERE "${u}" = ? AND (${otherKey})`
      }))
    }
  }
  plans.set(key, plan)
  return plan
}

/**
 * Writes one catalog row. Printings are matched by pkey (keeping their local id); other tables
 * upsert on their key, first dropping any row that holds a unique column value this row is taking
 * over. `extra` columns (e.g. `remote_id`, `contributed`) are written on both insert and update.
 *
 * `clearMissing` is for a source upsert (the portal's loader): the source lists the printing, so a
 * pkey match is un-flagged `missing_from_api` whatever the row says. Without it (the change feed)
 * the row's own `missing_from_api` is written, since the server's value is the truth.
 */
export function upsertCatalogRow(
  db: SqlDb,
  table: CatalogTable,
  row: Record<string, Scalar>,
  extra: Record<string, Scalar> = {},
  opts: { clearMissing?: boolean } = {}
): void {
  const all: Record<string, Scalar> = { ...row, ...extra }
  const cols = Object.keys(all).filter((c) => all[c] !== undefined)
  const values = cols.map((c) => all[c])
  const plan = rowSql(db, table, cols, opts.clearMissing ?? false)
  if (table.name === 'card_printings') {
    const { language: l, card_id: c, set_name: n, set_code: s, set_rarity: r } = row
    const found = prepared(db, `SELECT id FROM card_printings WHERE pkey = ${PKEY_SQL}`).get(
      l, c, s, r, l, c, n, s, r
    ) as { id: number } | undefined
    if (found) {
      if (plan.update)
        prepared(db, plan.update.sql).run(...plan.update.cols.map((x) => all[x]), found.id)
    } else {
      prepared(db, plan.insert).run(...values)
    }
    return
  }
  for (const { column, sql } of plan.dropHolders) {
    if (row[column] === undefined || row[column] === null) continue
    prepared(db, sql).run(row[column], ...table.key.map((k) => row[k]))
  }
  prepared(db, plan.insert).run(...values)
}
