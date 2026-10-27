import type {
  Database as Sqlite3Database,
  PreparedStatement,
  SAHPoolUtil,
  SqlValue,
  Sqlite3Static
} from '@sqlite.org/sqlite-wasm'
import type { SqlDb, SqlStatement } from '../../main/db/sql'
import { migrateSql } from '../../main/db/migrateSql'
import { applyPhoneSchema } from './phoneSchema'

const CACHE_LIMIT = 200

/**
 * Wraps a sqlite-wasm oo1 database in the SqlDb seam with better-sqlite3's semantics: positional
 * parameters, `get` is undefined without a row, and `transaction` nests through savepoints.
 */
export function wasmSql(db: Sqlite3Database): SqlDb {
  // Prepared statements live in wasm memory until finalized, so keep a small LRU instead of one per call.
  const cache = new Map<string, PreparedStatement>()

  function withStmt<T>(sql: string, params: unknown[], step: (stmt: PreparedStatement) => T): T {
    let stmt = cache.get(sql)
    if (stmt) cache.delete(sql)
    else stmt = db.prepare(sql)
    try {
      if (params.length > 0) stmt.bind(params as SqlValue[])
      const out = step(stmt)
      stmt.reset(true)
      cache.set(sql, stmt)
      if (cache.size > CACHE_LIMIT) {
        const [oldest, old] = cache.entries().next().value!
        cache.delete(oldest)
        old.finalize()
      }
      return out
    } catch (e) {
      stmt.finalize()
      throw e
    }
  }

  const lastInsertRowid = (): number | bigint =>
    withStmt('SELECT last_insert_rowid() AS id', [], (s) =>
      s.step() ? (s.get(0) as number | bigint) : 0
    )

  let depth = 0
  const quietly = (sql: string): void => {
    try {
      db.exec(sql)
    } catch {
      // SQLite may already have rolled back on its own; keep the original error.
    }
  }

  return {
    prepare(sql: string): SqlStatement {
      return {
        all: (...params) =>
          withStmt(sql, params, (s) => {
            const rows: unknown[] = []
            while (s.step()) rows.push(s.get({}))
            return rows
          }),
        get: (...params) => withStmt(sql, params, (s) => (s.step() ? s.get({}) : undefined)),
        run: (...params) => {
          withStmt(sql, params, (s) => s.step())
          return { changes: db.changes(), lastInsertRowid: lastInsertRowid() }
        }
      }
    },
    exec(sql: string): void {
      db.exec(sql)
    },
    transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
      return (...args: A): R => {
        const level = depth++
        const savepoint = `sqldb_sp_${level}`
        db.exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
        try {
          const result = fn(...args)
          db.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
          return result
        } catch (e) {
          if (level === 0) quietly('ROLLBACK')
          else quietly(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
          throw e
        } finally {
          depth--
        }
      }
    }
  }
}

/**
 * Opens the phone's database: in the OPFS SAH pool when given one, else in memory (tests). Foreign
 * keys are on, the desktop migrations run, then the phone-only tables are added.
 */
export function openWasmDb(
  sqlite3: Sqlite3Static,
  opts: { file?: string; poolUtil?: SAHPoolUtil }
): SqlDb {
  let raw: Sqlite3Database
  if (opts.poolUtil) {
    if (!opts.file) throw new Error('openWasmDb needs a file name for the OPFS pool')
    raw = new opts.poolUtil.OpfsSAHPoolDb(opts.file)
  } else {
    raw = new sqlite3.oo1.DB(':memory:')
  }
  try {
    const db = wasmSql(raw)
    db.exec('PRAGMA foreign_keys = ON')
    migrateSql(db)
    applyPhoneSchema(db)
    return db
  } catch (e) {
    raw.close()
    throw e
  }
}
