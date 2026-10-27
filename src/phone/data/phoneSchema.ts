import type { SqlDb } from '../../main/db/sql'

/** Version of the phone-only tables; bump it when they change shape. */
export const PHONE_FORMAT = 1

/** Creates the phone-only tables next to the desktop schema and stamps the format once. */
export function applyPhoneSchema(db: SqlDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS phone_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS phone_files (name TEXT PRIMARY KEY, etag TEXT, checked_at TEXT NOT NULL,
      bytes BLOB NOT NULL);
  `)
  db.prepare('INSERT OR IGNORE INTO phone_state (key, value) VALUES (?, ?)').run(
    'format',
    String(PHONE_FORMAT)
  )
}
