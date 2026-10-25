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
