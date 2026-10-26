import type { SqlDb } from '../db/sql'
import type { CatalogTable } from '../../shared/catalogTables'

// Imported by the portal Worker bundle: keep this file free of electron, node and better-sqlite3.

export type Scalar = string | number | null

/**
 * Same formula as the desktop V10 generated column `card_printings.pkey`. Numbers bind as
 * floats, so card_id is cast back to an integer before it is concatenated into the key.
 */
export const PKEY_SQL = `CASE WHEN ? = 'en' THEN 'en|' || CAST(? AS INTEGER) || '|' || ? || '|' || ?
  ELSE ? || '|' || CAST(? AS INTEGER) || '|' || ? || '|' || ? || '|' || ? END`

/**
 * Writes one catalog row. Printings are matched by pkey (keeping their local id) and a match is
 * un-flagged `missing_from_api`; other tables upsert on their key, first dropping any row that
 * holds a unique column value this row is taking over. `extra` columns (e.g. `remote_id`,
 * `contributed`) are written on both insert and update.
 */
export function upsertCatalogRow(
  db: SqlDb,
  table: CatalogTable,
  row: Record<string, Scalar>,
  extra: Record<string, Scalar> = {}
): void {
  const all: Record<string, Scalar> = { ...row, ...extra }
  const cols = Object.keys(all).filter((c) => all[c] !== undefined)
  const quoted = cols.map((c) => `"${c}"`)
  const values = cols.map((c) => all[c])
  if (table.name === 'card_printings') {
    const { language: l, card_id: c, set_name: n, set_code: s, set_rarity: r } = row
    const found = db
      .prepare(`SELECT id FROM card_printings WHERE pkey = ${PKEY_SQL}`)
      .get(l, c, s, r, l, c, n, s, r) as { id: number } | undefined
    if (found) {
      const written = cols.filter((x) => x !== 'missing_from_api')
      const set = written.map((x) => `"${x}" = ?`)
      db.prepare(
        `UPDATE card_printings SET ${[...set, 'missing_from_api = 0'].join(', ')} WHERE id = ?`
      ).run(...written.map((x) => all[x]), found.id)
    } else {
      db.prepare(
        `INSERT INTO card_printings (${quoted.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      ).run(...values)
    }
    return
  }
  for (const u of table.unique ?? []) {
    if (row[u] === undefined || row[u] === null) continue
    const otherKey = table.key.map((k) => `"${k}" IS NOT ?`).join(' OR ')
    db.prepare(`DELETE FROM ${table.name} WHERE "${u}" = ? AND (${otherKey})`).run(
      row[u],
      ...table.key.map((k) => row[k])
    )
  }
  const updates = cols.filter((c) => !table.key.includes(c)).map((c) => `"${c}" = excluded."${c}"`)
  const conflict = table.key.map((k) => `"${k}"`).join(', ')
  db.prepare(
    `INSERT INTO ${table.name} (${quoted.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ` +
      (updates.length > 0
        ? `ON CONFLICT(${conflict}) DO UPDATE SET ${updates.join(', ')}`
        : `ON CONFLICT(${conflict}) DO NOTHING`)
  ).run(...values)
}
