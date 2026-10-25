/** The slice of a synchronous SQLite handle the repo layer uses; better-sqlite3 and Durable Object storage both fit. */
export interface SqlStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

export interface SqlDb {
  prepare(sql: string): SqlStatement
  exec(sql: string): void
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
}
