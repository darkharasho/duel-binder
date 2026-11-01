import { MIGRATIONS, SCHEMA_V19_SERVER, SCHEMA_V20, SCHEMA_V27, SCHEMA_V28, type Migration } from '../../../src/main/db/schema'
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
      'id',
      'name',
      'type',
      'frame_type',
      'race',
      'attribute',
      'level',
      'linkval',
      'atk',
      'def',
      'archetype',
      'desc',
      'tcgplayer_price',
      'updated_at'
    ]
  },
  {
    name: 'card_images',
    key: ['image_id'],
    columns: ['image_id', 'card_id', 'sort_order', 'missing_from_api']
  },
  {
    name: 'card_printings',
    key: ['pkey'],
    columns: [
      'card_id',
      'set_name',
      'set_code',
      'set_rarity',
      'set_rarity_code',
      'set_price',
      'missing_from_api',
      'language',
      'tcg_product_id',
      'variant',
      'market_price'
    ],
    extra: ['contributed']
  },
  {
    name: 'sets',
    key: ['language', 'set_name'],
    columns: [
      'language',
      'set_name',
      'set_code',
      'tcg_date',
      'image_url',
      'image_key',
      'list_rows',
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
 * The insert, update and delete triggers that stamp a table's rows with a seq and tombstone deleted
 * (or re-keyed) rows. `game` is the SQL for a tombstone's game; without it the tombstone takes the
 * column default (the server-6 triggers, from before tombstones had a game). Shipped steps build
 * their SQL with this, so its output for a given table and game must never change.
 */
function seqTriggers(t: FrozenTable, game?: string): string[] {
  const stamp = `UPDATE catalog_clock SET seq = seq + 1; UPDATE ${t.name} SET catalog_seq = (SELECT seq FROM catalog_clock) WHERE rowid = NEW.rowid;`
  const watched = [...t.columns, ...(t.extra ?? [])]
  // card_printings.key is the generated pkey, which isn't in its column list.
  const changed = (t.name === 'card_printings' ? [...watched, 'pkey'] : watched)
    .map((c) => `NEW.${q(c)} IS NOT OLD.${q(c)}`)
    .join(' OR ')
  const key = t.key.map((c) => `OLD.${q(c)}`).join(', ')
  const rekeyed = t.key.map((c) => `NEW.${q(c)} IS NOT OLD.${q(c)}`).join(' OR ')
  const cols = game === undefined ? 'seq, tbl, key' : 'seq, tbl, key, game'
  const gameValue = game === undefined ? '' : `, ${game}`
  // A key changed in place: tombstone the old key first, so a client drops the row it holds
  // under that key before taking the row under its new one.
  const oldKeyTombstone =
    `UPDATE catalog_clock SET seq = seq + 1 WHERE ${rekeyed}; ` +
    `INSERT INTO catalog_tombstones (${cols}) SELECT (SELECT seq FROM catalog_clock), '${t.name}', json_array(${key})${gameValue} WHERE ${rekeyed};`
  return [
    `CREATE TRIGGER trg_${t.name}_seq_ins AFTER INSERT ON ${t.name} BEGIN ${stamp} END;`,
    `CREATE TRIGGER trg_${t.name}_seq_upd AFTER UPDATE ON ${t.name} WHEN ${changed} BEGIN ${oldKeyTombstone} ${stamp} END;`,
    `CREATE TRIGGER trg_${t.name}_seq_del AFTER DELETE ON ${t.name} BEGIN UPDATE catalog_clock SET seq = seq + 1; INSERT INTO catalog_tombstones (${cols}) VALUES ((SELECT seq FROM catalog_clock), '${t.name}', json_array(${key})${gameValue}); END;`
  ]
}

/**
 * Change-feed steps: a global clock, a `catalog_seq` per row (stamped by triggers on real changes),
 * and tombstones for deletes and for the old key of a row whose key changed in place.
 *
 * Split so each step commits on its own: the schema, then one backfill per table (every row gets a
 * seq and the table its index), then the triggers. On a full catalog the backfill is a lot of
 * work for one Durable Object startup; if a startup runs out of time, the finished steps stay done
 * and the next startup carries on. The triggers come last, so no backfill fires them.
 *
 * WARNING: a future desktop step that rebuilds a catalog table on the server (drop, recreate,
 * reinsert) would fire these triggers: it would tombstone and re-stamp every row.
 */
function catalogFeedSteps(tables: FrozenTable[]): ServerStep[] {
  const steps: ServerStep[] = []
  steps.push({
    name: 'server-6',
    sql: [
      'CREATE TABLE catalog_clock (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);',
      'INSERT INTO catalog_clock (id, seq) VALUES (1, 0);',
      ...tables.map(
        (t) => `ALTER TABLE ${t.name} ADD COLUMN catalog_seq INTEGER NOT NULL DEFAULT 0;`
      ),
      'CREATE TABLE catalog_tombstones (seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, key TEXT NOT NULL);',
      `CREATE TABLE printing_contributions (printing_id INTEGER PRIMARY KEY REFERENCES card_printings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);`,
      'CREATE INDEX ix_contributions_user ON printing_contributions(user_id, created_at);'
    ].join('\n')
  })
  for (const t of tables) {
    steps.push({
      name: `server-6-backfill-${t.name}`,
      sql: [
        `UPDATE ${t.name} SET catalog_seq = c.base + x.rn FROM (SELECT rowid AS r, row_number() OVER (ORDER BY rowid) AS rn FROM ${t.name}) AS x, (SELECT seq AS base FROM catalog_clock) AS c WHERE ${t.name}.rowid = x.r;`,
        `UPDATE catalog_clock SET seq = seq + (SELECT count(*) FROM ${t.name});`,
        `CREATE INDEX ix_${t.name}_catalog_seq ON ${t.name}(catalog_seq);`
      ].join('\n')
    })
  }
  const triggers = tables.flatMap((t) => seqTriggers(t))
  steps.push({ name: 'server-6-triggers', sql: triggers.join('\n') })
  return steps
}

/**
 * Frozen copy, as of server-12, of the catalog tables that belong to more than one game or to
 * Pokémon only. Like SERVER_6_TABLES, never read the live list here.
 */
const SERVER_12_TABLES: (FrozenTable & { game: string })[] = [
  ...['cards', 'card_images', 'card_printings'].map((name) => {
    const t = SERVER_6_TABLES.find((x) => x.name === name)!
    return { ...t, columns: [...t.columns, 'game'], game: 'OLD."game"' }
  }),
  {
    name: 'sets',
    key: ['game', 'language', 'set_name'],
    columns: [
      'game',
      'language',
      'set_name',
      'set_code',
      'tcg_date',
      'image_url',
      'image_key',
      'list_rows',
      'unmatched_rows'
    ],
    game: 'OLD."game"'
  },
  {
    name: 'pokemon_cards',
    key: ['card_id'],
    columns: ['card_id', 'category', 'hp', 'types', 'stage', 'rarity', 'illustrator', 'source_id'],
    game: "'pkm'"
  }
]

/**
 * Multi-game: the server's V19 (SCHEMA_V19_SERVER), tombstones that carry a game, a
 * `(game, catalog_seq)` index per game-bearing table for per-game feeds, and the seq triggers
 * recreated so tombstones record the game (`sets` tombstones its three-part key). Nothing is
 * re-stamped: the rebuilt `sets` keeps its seqs, and no trigger exists while it is rebuilt.
 */
function multiGameStep(): ServerStep {
  const shared = SERVER_12_TABLES.filter((t) => t.columns.includes('game'))
  return {
    name: 'server-12',
    sql: [
      "ALTER TABLE catalog_tombstones ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';",
      SCHEMA_V19_SERVER.trim(),
      ...shared.map((t) => `CREATE INDEX ix_${t.name}_game_seq ON ${t.name}(game, catalog_seq);`),
      ...SERVER_12_TABLES.flatMap((t) =>
        ['ins', 'upd', 'del'].map((op) => `DROP TRIGGER IF EXISTS trg_${t.name}_seq_${op};`)
      ),
      ...SERVER_12_TABLES.flatMap((t) => seqTriggers(t, t.game))
    ].join('\n')
  }
}

/** Frozen, as of server-13: server-12's `pokemon_cards` entry plus `image_url` and `local_name`. */
const SERVER_13_POKEMON_CARDS: FrozenTable = {
  name: 'pokemon_cards',
  key: ['card_id'],
  columns: [
    'card_id',
    'category',
    'hp',
    'types',
    'stage',
    'rarity',
    'illustrator',
    'source_id',
    'image_url',
    'local_name'
  ]
}

/**
 * The two new `pokemon_cards` columns (the server's V20), and the seq triggers recreated over them:
 * without that, a change to only one of the two would never bump `catalog_seq`.
 */
function pokemonColumnsStep(): ServerStep {
  return {
    name: 'server-13',
    sql: [
      SCHEMA_V20.trim(),
      ...['ins', 'upd', 'del'].map((op) => `DROP TRIGGER IF EXISTS trg_pokemon_cards_seq_${op};`),
      ...seqTriggers(SERVER_13_POKEMON_CARDS, "'pkm'")
    ].join('\n')
  }
}

/** Frozen, as of server-14: the Pokémon set art table desktop step 23 creates. */
const SERVER_14_POKEMON_SET_ART: FrozenTable = {
  name: 'pokemon_set_art',
  key: ['language', 'set_name', 'kind', 'sort_order'],
  columns: ['language', 'set_name', 'kind', 'sort_order', 'image_url', 'image_key']
}

/**
 * `pokemon_set_art` (desktop step 23) joins the change feed: its `catalog_seq`, the index the feed
 * reads, and the seq triggers, whose tombstones are Pokémon ones. Desktop step 23 always runs
 * first (on a fresh server with every desktop step, on an upgraded one before the server steps it
 * lacks) and the table starts empty, so there is nothing to backfill.
 */
function pokemonSetArtStep(): ServerStep {
  const t = SERVER_14_POKEMON_SET_ART
  return {
    name: 'server-14',
    sql: [
      `ALTER TABLE ${t.name} ADD COLUMN catalog_seq INTEGER NOT NULL DEFAULT 0;`,
      `CREATE INDEX ix_${t.name}_catalog_seq ON ${t.name}(catalog_seq);`,
      ...seqTriggers(t, "'pkm'")
    ].join('\n')
  }
}

/** Frozen, as of server-16: server-13's `pokemon_cards` entry plus `art_twin_id`. */
const SERVER_16_POKEMON_CARDS: FrozenTable = {
  name: 'pokemon_cards',
  key: ['card_id'],
  columns: [...SERVER_13_POKEMON_CARDS.columns, 'art_twin_id']
}

/** `art_twin_id` (the server's V27), and the seq triggers recreated over it, as in server-13. */
function artTwinStep(): ServerStep {
  return {
    name: 'server-16',
    sql: [
      SCHEMA_V27.trim(),
      ...['ins', 'upd', 'del'].map((op) => `DROP TRIGGER IF EXISTS trg_pokemon_cards_seq_${op};`),
      ...seqTriggers(SERVER_16_POKEMON_CARDS, "'pkm'")
    ].join('\n')
  }
}

/** Frozen, as of server-18: server-16's `pokemon_cards` entry plus `traditional_twin_id`. */
const SERVER_18_POKEMON_CARDS: FrozenTable = {
  name: 'pokemon_cards',
  key: ['card_id'],
  columns: [...SERVER_16_POKEMON_CARDS.columns, 'traditional_twin_id']
}

/** `traditional_twin_id` (the server's V28), and the seq triggers recreated over it, as in server-16. */
function traditionalTwinStep(): ServerStep {
  return {
    name: 'server-18',
    sql: [
      SCHEMA_V28.trim(),
      ...['ins', 'upd', 'del'].map((op) => `DROP TRIGGER IF EXISTS trg_pokemon_cards_seq_${op};`),
      ...seqTriggers(SERVER_18_POKEMON_CARDS, "'pkm'")
    ].join('\n')
  }
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
  ...catalogFeedSteps(SERVER_6_TABLES),
  {
    // Apple refresh tokens, kept only so deleting an account can revoke its Sign in with Apple.
    name: 'server-7',
    sql: `
CREATE TABLE apple_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  updated_at TEXT NOT NULL);
`
  },
  {
    // How many printings each user asked to have priced each (UTC) day; see priceRequests.ts.
    name: 'server-8',
    sql: `
CREATE TABLE price_request_log (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day));
CREATE INDEX ix_price_request_log_day ON price_request_log(day);
`
  },
  {
    // When each user last made a signed-in request, to the hour; feeds /admin/stats active counts.
    name: 'server-9',
    sql: 'ALTER TABLE users ADD COLUMN last_seen_at TEXT;'
  },
  {
    // Anonymous usage: per-day event totals by platform, with nothing that names a user or device.
    name: 'server-10',
    sql: `CREATE TABLE usage_daily (
      day TEXT NOT NULL,
      platform TEXT NOT NULL,
      event TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (day, platform, event)
    ) WITHOUT ROWID;`
  },
  {
    // Weekly eBay set sweep: the prefix queue, and a change clock on intl_prices so a client pulls only
    // rows whose price or listing count moved (a checked_at-only refresh stamps nothing).
    name: 'server-11',
    sql: `CREATE TABLE price_sweeps (key TEXT NOT NULL, language TEXT NOT NULL, owned INTEGER NOT NULL DEFAULT 0,
  released TEXT, swept_at TEXT, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, language)) WITHOUT ROWID;
CREATE INDEX ix_price_sweeps_due ON price_sweeps(owned DESC, swept_at, released DESC);
ALTER TABLE intl_prices ADD COLUMN price_seq INTEGER NOT NULL DEFAULT 0;
UPDATE intl_prices SET price_seq = c.base + x.rn FROM (SELECT rowid AS r, row_number() OVER (ORDER BY rowid) AS rn FROM intl_prices) AS x, (SELECT seq AS base FROM catalog_clock) AS c WHERE intl_prices.rowid = x.r;
UPDATE catalog_clock SET seq = seq + (SELECT count(*) FROM intl_prices);
CREATE INDEX ix_intl_prices_seq ON intl_prices(price_seq);
CREATE TRIGGER trg_intl_prices_seq_ins AFTER INSERT ON intl_prices BEGIN UPDATE catalog_clock SET seq = seq + 1; UPDATE intl_prices SET price_seq = (SELECT seq FROM catalog_clock) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER trg_intl_prices_seq_upd AFTER UPDATE ON intl_prices WHEN NEW.price IS NOT OLD.price BEGIN UPDATE catalog_clock SET seq = seq + 1; UPDATE intl_prices SET price_seq = (SELECT seq FROM catalog_clock) WHERE rowid = NEW.rowid; END;`
  },
  multiGameStep(),
  pokemonColumnsStep(),
  pokemonSetArtStep(),
  {
    // Wishlists, numbered by their own clock (`seq`), and whether a user hides theirs from friends.
    name: 'server-15',
    sql: `
CREATE TABLE wishlist_entries (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, pkey TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT 'ygo', quantity INTEGER CHECK (quantity >= 1), created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT, seq INTEGER NOT NULL, PRIMARY KEY (user_id, pkey));
CREATE UNIQUE INDEX ux_wishlist_seq ON wishlist_entries(seq);
CREATE INDEX ix_wishlist_user_seq ON wishlist_entries(user_id, seq);
ALTER TABLE users ADD COLUMN wishlist_hidden INTEGER NOT NULL DEFAULT 0;
`
  },
  artTwinStep(),
  {
    // Anonymous error reports: the day, not the moment, and nothing that names a user or device.
    name: 'server-17',
    sql: `CREATE TABLE error_reports (
      id INTEGER PRIMARY KEY,
      day TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_version TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT
    );
    CREATE INDEX ix_error_reports_day ON error_reports(day);`
  },
  traditionalTwinStep(),
  {
    // Binders and their edits, numbered by their own clocks (`seq`), as wishlist_entries is in server-15.
    name: 'server-19',
    sql: `
CREATE TABLE binders (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, uid TEXT NOT NULL,
  game TEXT NOT NULL, name TEXT NOT NULL, rules TEXT NOT NULL, goal TEXT NOT NULL, languages TEXT NOT NULL,
  friends_visible INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  seq INTEGER NOT NULL, PRIMARY KEY (user_id, uid));
CREATE UNIQUE INDEX ux_binders_seq ON binders(seq);
CREATE INDEX ix_binders_user_seq ON binders(user_id, seq);
CREATE TABLE binder_edits (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, binder_uid TEXT NOT NULL,
  level TEXT NOT NULL, target TEXT NOT NULL, game TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT, seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, binder_uid, level, target));
CREATE UNIQUE INDEX ux_binder_edits_seq ON binder_edits(seq);
CREATE INDEX ix_binder_edits_user_seq ON binder_edits(user_id, seq);
`
  },
  // Its own step so a slow build commits alone.
  { name: 'server-20', sql: 'CREATE INDEX ix_printings_card ON card_printings(card_id);' },
  { name: 'server-21', sql: 'CREATE INDEX ix_pokemon_cards_illustrator ON pokemon_cards(illustrator);' },
  { name: 'server-22', sql: 'CREATE INDEX ix_cards_name ON cards(name COLLATE NOCASE);' },
  { name: 'server-23', sql: 'CREATE INDEX ix_pokemon_cards_local_name ON pokemon_cards(local_name COLLATE NOCASE);' },
  { name: 'server-24', sql: 'CREATE INDEX ix_printings_set_name ON card_printings(set_name);' },
  { name: 'server-25', sql: 'CREATE INDEX ix_cards_archetype ON cards(archetype);' }
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
