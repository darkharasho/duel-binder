import type { SqlDb, SqlStatement } from '../../../src/main/db/sql'

/** Adapts a SQLite-backed Durable Object's storage to the repo layer's SqlDb. */
export function doSql(storage: DurableObjectStorage): SqlDb {
  const sql = storage.sql
  const exec = (
    query: string,
    params: unknown[]
  ): SqlStorageCursor<Record<string, SqlStorageValue>> =>
    sql.exec(query, ...(params as SqlStorageValue[]))

  const prepare = (query: string): SqlStatement => ({
    all: (...params) => exec(query, params).toArray(),
    get: (...params) => exec(query, params).toArray()[0],
    run: (...params) => {
      const cursor = exec(query, params)
      cursor.toArray() // drain so rowsWritten is final
      const lastInsertRowid = sql.exec<{ id: number }>('SELECT last_insert_rowid() AS id').one().id
      return { changes: cursor.rowsWritten, lastInsertRowid }
    }
  })

  return {
    prepare,
    exec: (query) => {
      sql.exec(query)
    },
    transaction:
      (fn) =>
      (...args) =>
        storage.transactionSync(() => fn(...args))
  }
}
