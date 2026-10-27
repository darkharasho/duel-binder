import Database from 'better-sqlite3'
import { migrateSql } from './migrateSql'

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
  migrateSql(db)
}
