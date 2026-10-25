import { MIGRATIONS, type Migration } from '../../../src/main/db/schema'
import type { SqlDb } from '../../../src/main/db/sql'

export interface ServerStep {
  name: string
  sql: string
}

/** Server-only steps, run after every desktop step. Append only; never edit a shipped step. */
export const SERVER_STEPS: ServerStep[] = [
  {
    name: 'server-1',
    sql: `
CREATE TABLE users (id INTEGER PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
  display_name TEXT, avatar TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX ux_users_username ON users(username COLLATE NOCASE);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
-- collection_entries rebuilt per user, tombstone-ready
DROP TABLE collection_entries;
CREATE TABLE collection_entries (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  uid TEXT NOT NULL UNIQUE, printing_id INTEGER NOT NULL REFERENCES card_printings(id),
  image_id INTEGER NOT NULL REFERENCES card_images(image_id), quantity INTEGER NOT NULL CHECK (quantity >= 1),
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE UNIQUE INDEX ux_entries_live ON collection_entries(user_id, printing_id, image_id) WHERE deleted_at IS NULL;
DROP TABLE value_snapshots;
CREATE TABLE value_snapshots (user_id INTEGER NOT NULL REFERENCES users(id), date TEXT NOT NULL,
  total_value REAL NOT NULL, total_cards INTEGER NOT NULL, PRIMARY KEY (user_id, date));
`
  }
]

/** Run each not-yet-recorded step in its own transaction; never issues PRAGMA. */
export function runSteps(db: SqlDb, steps: (Migration | ServerStep)[]): void {
  db.exec('CREATE TABLE IF NOT EXISTS server_migrations (name TEXT PRIMARY KEY)')
  const isDone = db.prepare('SELECT 1 FROM server_migrations WHERE name = ?')
  const record = db.prepare('INSERT INTO server_migrations (name) VALUES (?)')
  for (const step of steps) {
    const name = 'name' in step ? step.name : `desktop-${step.version}`
    if (isDone.get(name)) continue
    const sql = 'name' in step ? step.sql : step.server === undefined ? step.sql : step.server
    db.transaction(() => {
      if (sql !== false) db.exec(sql)
      record.run(name)
    })()
  }
}

export function migrateServer(db: SqlDb): void {
  runSteps(db, [...MIGRATIONS, ...SERVER_STEPS])
}
