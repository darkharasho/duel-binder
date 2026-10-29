import type Database from 'better-sqlite3'
import type { CatalogTable } from '../../src/shared/catalogTables'

export interface TableDiff {
  /** Rows to send to `/admin/catalog/rows`: exactly the table's `columns`. */
  upserts: Record<string, unknown>[]
  /** Key tuples to send to `/admin/catalog/delete`, in `key` order. */
  deletes: unknown[][]
}

const quote = (c: string): string => `"${c}"`

/**
 * What changed in `work` since `base` (the last uploaded snapshot): rows of `work` whose key and
 * columns don't all match a `base` row, and keys in `base` that `work` no longer has. With no
 * base, every row is an upsert. `base` is ATTACHed to the work connection by file name, so it
 * must be a file-backed database.
 */
export function diffTable(
  work: Database.Database,
  base: Database.Database | null,
  t: CatalogTable
): TableDiff {
  const compared = [...new Set([...t.key, ...t.columns])].map(quote).join(', ')
  const columns = t.columns.map(quote).join(', ')
  const keys = t.key.map(quote).join(', ')
  const select = (sql: string): Record<string, unknown>[] =>
    work.prepare(sql).all() as Record<string, unknown>[]

  if (!base) return { upserts: select(`SELECT ${columns} FROM main.${t.name}`), deletes: [] }
  if (base.memory) throw new Error('diffTable needs a file-backed base database')

  work.prepare('ATTACH DATABASE ? AS base').run(base.name)
  try {
    // EXCEPT treats NULLs as equal, so a row with unchanged NULLs is not an upsert.
    const upserts = select(
      `SELECT ${columns} FROM (SELECT ${compared} FROM main.${t.name}
       EXCEPT SELECT ${compared} FROM base.${t.name})`
    )
    const deletes = work
      .prepare(`SELECT ${keys} FROM base.${t.name} EXCEPT SELECT ${keys} FROM main.${t.name}`)
      .raw()
      .all() as unknown[][]
    return { upserts, deletes }
  } finally {
    work.exec('DETACH DATABASE base')
  }
}

/** Whether rows of `t` carry a `game` column (a table both games use). */
export const hasGameColumn = (t: CatalogTable): boolean => t.games.length > 1

/**
 * How many rows `base` has that `work` lacks (by key), per game of the deleted base row. Tables
 * without a `game` column count everything under their one game.
 */
export function deletesByGame(
  work: Database.Database,
  base: Database.Database | null,
  t: CatalogTable
): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(t.games.map((g) => [g, 0]))
  if (!base) return out
  if (base.memory) throw new Error('deletesByGame needs a file-backed base database')
  const same = t.key.map((k) => `w.${quote(k)} = b.${quote(k)}`).join(' AND ')
  const game = hasGameColumn(t) ? 'b.game' : `'${t.games[0]}'`
  work.prepare('ATTACH DATABASE ? AS base').run(base.name)
  try {
    const rows = work
      .prepare(
        `SELECT ${game} AS game, count(*) AS n FROM base.${t.name} b
         WHERE NOT EXISTS (SELECT 1 FROM main.${t.name} w WHERE ${same}) GROUP BY 1`
      )
      .all() as { game: string; n: number }[]
    for (const r of rows) out[r.game] = (out[r.game] ?? 0) + r.n
    return out
  } finally {
    work.exec('DETACH DATABASE base')
  }
}
