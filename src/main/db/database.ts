import Database from 'better-sqlite3'
import { MIGRATIONS } from './schema'

export {
  SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9,
  RARITY_LABEL, MIGRATIONS
} from './schema'

export function openDatabase(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  try {
    migrate(db)
  } catch (e) {
    db.close()
    throw e
  }
  return db
}

/** Applies every migration newer than PRAGMA user_version, each in its own transaction. */
export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      if (migration.foreignKeysOff) {
        const violations = db.pragma('foreign_key_check') as unknown[]
        if (violations.length > 0) {
          throw new Error(`Migration ${migration.version} left ${violations.length} foreign key violation(s)`)
        }
      }
      db.pragma(`user_version = ${migration.version}`)
    })
    if (!migration.foreignKeysOff) {
      apply()
      continue
    }
    // PRAGMA foreign_keys is a no-op inside a transaction, so toggle it around the transaction.
    const previous = db.pragma('foreign_keys', { simple: true }) as number
    db.pragma('foreign_keys = OFF')
    try {
      apply()
    } finally {
      db.pragma(`foreign_keys = ${previous ? 'ON' : 'OFF'}`)
    }
  }
}
