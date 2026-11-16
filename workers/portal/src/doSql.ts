import type { SqlDb, SqlStatement } from '../../../src/main/db/sql'

/**
 * Adapts a SQLite-backed Durable Object's storage to the repo layer's SqlDb. `count` is told each
 * statement's rows read and written once it has run (the meter's rows, see meter.ts).
 */
export function doSql(
  storage: DurableObjectStorage,
  count: (rowsRead: number, rowsWritten: number) => void = () => {}
): SqlDb {
  const sql = storage.sql
  const drained = <T>(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>, rows: T): T => {
    count(cursor.rowsRead, cursor.rowsWritten)
    return rows
  }
  const exec = (
    query: string,
    params: unknown[]
  ): SqlStorageCursor<Record<string, SqlStorageValue>> =>
    sql.exec(query, ...(params as SqlStorageValue[]))

  const prepare = (query: string): SqlStatement => ({
    all: (...params) => {
      const cursor = exec(query, params)
      return drained(cursor, cursor.toArray())
    },
    get: (...params) => {
      const cursor = exec(query, params)
      return drained(cursor, cursor.toArray()[0])
    },
    run: (...params) => {
      const cursor = exec(query, params)
      drained(cursor, cursor.toArray()) // drain so the statement has fully run
      const after = sql.exec<{ id: number; n: number }>(
        'SELECT last_insert_rowid() AS id, changes() AS n'
      )
      const { id, n } = after.one()
      count(after.rowsRead, after.rowsWritten)
      return { changes: n, lastInsertRowid: id }
    }
  })

  return {
    prepare,
    exec: (query) => {
      const cursor = sql.exec(query)
      count(cursor.rowsRead, cursor.rowsWritten)
    },
    transaction:
      (fn) =>
      (...args) =>
        storage.transactionSync(() => fn(...args))
  }
}
