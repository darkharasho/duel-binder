import { MIGRATIONS, type Migration } from '../../../src/main/db/schema'
import type { SqlDb } from '../../../src/main/db/sql'

export interface ServerStep {
  name: string
  sql: string
}

interface FrozenTable {
  name: string
  key: string[]
  columns: string[]
  /** Extra columns whose change counts as a row change. */
  extra?: string[]
}

/**
 * Frozen copy of CATALOG_TABLES (src/shared/catalogTables.ts) as of server-6. Never read the live
 * list here: a shipped step must not change. Key order matters; tombstone keys list the key columns
 * in this order.
 */
const SERVER_6_TABLES: FrozenTable[] = [
  {
    name: 'cards',
    key: ['id'],
    columns: [
      'id', 'name', 'type', 'frame_type', 'race', 'attribute', 'level', 'linkval', 'atk', 'def',
      'archetype', 'desc', 'tcgplayer_price', 'updated_at'
    ]
  },
  { name: 'card_images', key: ['image_id'], columns: ['image_id', 'card_id', 'sort_order', 'missing_from_api'] },
  {
    name: 'card_printings',
    key: ['pkey'],
    columns: [
      'card_id', 'set_name', 'set_code', 'set_rarity', 'set_rarity_code', 'set_price',
      'missing_from_api', 'language', 'tcg_product_id', 'variant', 'market_price'
    ],
    extra: ['contributed']
  },
  {
    name: 'sets',
    key: ['language', 'set_name'],
    columns: [
      'language', 'set_name', 'set_code', 'tcg_date', 'image_url', 'image_key', 'list_rows',
      'unmatched_rows'
    ]
  },
  { name: 'pack_art', key: ['set_name'], columns: ['set_name', 'image_url', 'image_key'] },
  { name: 'set_logos', key: ['set_name'], columns: ['set_name', 'image_url', 'image_key'] },
  { name: 'konami_logos', key: ['set_name'], columns: ['set_name', 'image_url', 'image_key'] },
  { name: 'tcgplayer_groups', key: ['group_id'], columns: ['group_id', 'modified_on', 'name'] },
  {
    name: 'tcgplayer_products',
    key: ['product_id'],
    columns: ['product_id', 'group_id', 'number', 'rarity', 'image_url', 'name']
  }
]

const q = (c: string): string => `"${c}"`

/**
 * Change-feed SQL: a global clock, a `catalog_seq` per row (stamped by triggers on real changes),
 * and tombstones for deletes.
 *
 * WARNING: a future desktop step that rebuilds a catalog table on the server (drop, recreate,
 * reinsert) would fire these triggers: it would tombstone and re-stamp every row.
 */
function catalogFeedSql(tables: FrozenTable[]): string {
  const out: string[] = [
    'CREATE TABLE catalog_clock (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);',
    'INSERT INTO catalog_clock (id, seq) VALUES (1, 0);'
  ]
  for (const t of tables) {
    out.push(`ALTER TABLE ${t.name} ADD COLUMN catalog_seq INTEGER NOT NULL DEFAULT 0;`)
  }
  for (const t of tables) {
    out.push(
      `UPDATE ${t.name} SET catalog_seq = c.base + x.rn FROM (SELECT rowid AS r, row_number() OVER (ORDER BY rowid) AS rn FROM ${t.name}) AS x, (SELECT seq AS base FROM catalog_clock) AS c WHERE ${t.name}.rowid = x.r;`,
      `UPDATE catalog_clock SET seq = seq + (SELECT count(*) FROM ${t.name});`
    )
  }
  for (const t of tables) {
    out.push(`CREATE INDEX ix_${t.name}_catalog_seq ON ${t.name}(catalog_seq);`)
  }
  out.push(
    'CREATE TABLE catalog_tombstones (seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, key TEXT NOT NULL);',
    `CREATE TABLE printing_contributions (printing_id INTEGER PRIMARY KEY REFERENCES card_printings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);`,
    'CREATE INDEX ix_contributions_user ON printing_contributions(user_id, created_at);'
  )
  const stamp = (t: FrozenTable): string =>
    `UPDATE catalog_clock SET seq = seq + 1; UPDATE ${t.name} SET catalog_seq = (SELECT seq FROM catalog_clock) WHERE rowid = NEW.rowid;`
  for (const t of tables) {
    const watched = [...t.columns, ...(t.extra ?? [])]
    // card_printings.key is the generated pkey, which isn't in its column list.
    const changed = (t.name === 'card_printings' ? [...watched, 'pkey'] : watched)
      .map((c) => `NEW.${q(c)} IS NOT OLD.${q(c)}`)
      .join(' OR ')
    const key = t.key.map((c) => `OLD.${q(c)}`).join(', ')
    out.push(
      `CREATE TRIGGER trg_${t.name}_seq_ins AFTER INSERT ON ${t.name} BEGIN ${stamp(t)} END;`,
      `CREATE TRIGGER trg_${t.name}_seq_upd AFTER UPDATE ON ${t.name} WHEN ${changed} BEGIN ${stamp(t)} END;`,
      `CREATE TRIGGER trg_${t.name}_seq_del AFTER DELETE ON ${t.name} BEGIN UPDATE catalog_clock SET seq = seq + 1; INSERT INTO catalog_tombstones (seq, tbl, key) VALUES ((SELECT seq FROM catalog_clock), '${t.name}', json_array(${key})); END;`
    )
  }
  return out.join('\n')
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
  },
  {
    name: 'server-5',
    sql: `
CREATE TABLE friend_blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id));
CREATE INDEX ix_friend_blocks_blocked ON friend_blocks(blocked_id);
`
  },
  { name: 'server-6', sql: catalogFeedSql(SERVER_6_TABLES) }
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
