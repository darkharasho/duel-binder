import { MIGRATIONS, type Migration } from '../../../src/main/db/schema'
import type { SqlDb } from '../../../src/main/db/sql'

export interface ServerStep {
  name: string
  sql: string
}

/**
 * Server-only steps, run after every desktop step. Append only; never edit a shipped step.
 *
 * Ordering rule: an upgraded server runs new desktop steps after the server steps it already has,
 * while a fresh server runs every desktop step first. So any desktop step from 12 on that touches
 * `collection_entries` or `value_snapshots` (whose server shape server-1 replaced) must set
 * `server: false` and put the server's version of the change in a new entry here.
 */
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
  },
  {
    name: 'server-2',
    sql: `
ALTER TABLE collection_entries ADD COLUMN server_seq INTEGER NOT NULL DEFAULT 0;
UPDATE collection_entries SET server_seq = id;
CREATE UNIQUE INDEX ux_entries_seq ON collection_entries(server_seq);
CREATE INDEX ix_entries_user_seq ON collection_entries(user_id, server_seq);
CREATE INDEX ix_entries_printing_live ON collection_entries(printing_id) WHERE deleted_at IS NULL;
CREATE TABLE desktop_codes (code_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX ix_sessions_expires ON sessions(expires_at);
`
  },
  {
    name: 'server-3',
    sql: `
CREATE TABLE friendships (
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id));
CREATE INDEX ix_friendships_addressee ON friendships(addressee_id, status);
`
  },
  {
    name: 'server-4',
    sql: `
CREATE TABLE friend_request_log (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL);
CREATE INDEX ix_friend_request_log ON friend_request_log(user_id, created_at);
`
  }
]

/**
 * Desktop versions with `foreignKeysOff` and no `server` override that only ever run on a fresh
 * server: every desktop step runs at creation, before any catalog or user data exists, so their
 * table rebuilds cannot hit a foreign key. Never add a version that could run on a populated server.
 */
const FRESH_ONLY_FK_OFF = new Set([3])

/** Run each not-yet-recorded step in its own transaction; never issues PRAGMA. */
export function runSteps(db: SqlDb, steps: (Migration | ServerStep)[]): void {
  db.exec('CREATE TABLE IF NOT EXISTS server_migrations (name TEXT PRIMARY KEY)')
  const isDone = db.prepare('SELECT 1 FROM server_migrations WHERE name = ?')
  const record = db.prepare('INSERT INTO server_migrations (name) VALUES (?)')
  for (const step of steps) {
    const name = 'name' in step ? step.name : `desktop-${step.version}`
    if (isDone.get(name)) continue
    // Foreign keys are always on in a Durable Object (PRAGMA foreign_keys can't be changed), so a
    // step that rebuilds a referenced table would fail once rows exist. Such a step needs a
    // server-specific version.
    if (
      !('name' in step) &&
      step.foreignKeysOff &&
      step.server === undefined &&
      !FRESH_ONLY_FK_OFF.has(step.version)
    ) {
      throw new Error(
        `${name} needs foreignKeysOff, which the server can't do; give it a server override`
      )
    }
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
