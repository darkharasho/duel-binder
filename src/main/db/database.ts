import Database from 'better-sqlite3'

interface Migration {
  version: number
  sql: string
  /** Run with foreign keys off (needed to rebuild a referenced table); checked before commit. */
  foreignKeysOff?: true
}

export const SCHEMA_V1 = `
CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, frame_type TEXT NOT NULL,
  race TEXT NOT NULL, attribute TEXT, level INTEGER, linkval INTEGER, atk INTEGER, def INTEGER, archetype TEXT,
  "desc" TEXT NOT NULL, tcgplayer_price REAL, updated_at TEXT NOT NULL);
CREATE VIRTUAL TABLE cards_fts USING fts5(name, content='cards', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TABLE card_printings (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id),
  set_name TEXT NOT NULL, set_code TEXT NOT NULL, set_rarity TEXT NOT NULL, set_rarity_code TEXT NOT NULL DEFAULT '',
  set_price REAL, missing_from_api INTEGER NOT NULL DEFAULT 0, UNIQUE (card_id, set_code, set_rarity));
CREATE INDEX idx_printings_set_code ON card_printings(set_code COLLATE NOCASE);
CREATE TABLE card_images (image_id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id),
  sort_order INTEGER NOT NULL, missing_from_api INTEGER NOT NULL DEFAULT 0);
CREATE TABLE collection_entries (id INTEGER PRIMARY KEY, printing_id INTEGER NOT NULL REFERENCES card_printings(id),
  image_id INTEGER NOT NULL REFERENCES card_images(image_id), quantity INTEGER NOT NULL CHECK (quantity >= 1),
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (printing_id, image_id));
CREATE TABLE value_snapshots (date TEXT PRIMARY KEY, total_value REAL NOT NULL, total_cards INTEGER NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export const SCHEMA_V2 = `
CREATE TABLE sets (set_name TEXT PRIMARY KEY, set_code TEXT NOT NULL, tcg_date TEXT, image_url TEXT);
CREATE INDEX idx_printings_set_name ON card_printings(set_name);
CREATE INDEX idx_images_card ON card_images(card_id, sort_order);
`

/** Per-language printings and sets. card_printings is rebuilt to replace its inline UNIQUE. */
const SCHEMA_V3 = `
CREATE TABLE card_printings_new (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id),
  set_name TEXT NOT NULL, set_code TEXT NOT NULL, set_rarity TEXT NOT NULL, set_rarity_code TEXT NOT NULL DEFAULT '',
  set_price REAL, missing_from_api INTEGER NOT NULL DEFAULT 0, language TEXT NOT NULL DEFAULT 'en');
INSERT INTO card_printings_new (id, card_id, set_name, set_code, set_rarity, set_rarity_code, set_price, missing_from_api)
  SELECT id, card_id, set_name, set_code, set_rarity, set_rarity_code, set_price, missing_from_api FROM card_printings;
DROP TABLE card_printings;
ALTER TABLE card_printings_new RENAME TO card_printings;
CREATE INDEX idx_printings_set_code ON card_printings(set_code COLLATE NOCASE);
CREATE INDEX idx_printings_lang_set ON card_printings(language, set_name, card_id, set_rarity);
CREATE UNIQUE INDEX ux_printings_en ON card_printings(card_id, set_code, set_rarity) WHERE language = 'en';
CREATE UNIQUE INDEX ux_printings_intl ON card_printings(card_id, language, set_name, set_code, set_rarity)
  WHERE language <> 'en';
CREATE TABLE sets_new (language TEXT NOT NULL DEFAULT 'en', set_name TEXT NOT NULL, set_code TEXT NOT NULL,
  tcg_date TEXT, image_url TEXT, image_key TEXT, list_rows INTEGER, unmatched_rows INTEGER,
  PRIMARY KEY (language, set_name));
INSERT INTO sets_new (language, set_name, set_code, tcg_date, image_url)
  SELECT 'en', set_name, set_code, tcg_date, image_url FROM sets;
DROP TABLE sets;
ALTER TABLE sets_new RENAME TO sets;
CREATE TABLE intl_prices (printing_id INTEGER PRIMARY KEY REFERENCES card_printings(id) ON DELETE CASCADE,
  price REAL, listing_count INTEGER NOT NULL, checked_at TEXT NOT NULL);
`

export const SCHEMA_V4 = `
CREATE TABLE printing_art (printing_id INTEGER PRIMARY KEY REFERENCES card_printings(id) ON DELETE CASCADE,
  url TEXT, checked_at TEXT NOT NULL);
`

/** TCGplayer's Yu-Gi-Oh catalog (via TCGCSV), kept only as far as matching printings to photos. */
export const SCHEMA_V5 = `
CREATE TABLE tcgplayer_groups (group_id INTEGER PRIMARY KEY, modified_on TEXT NOT NULL);
CREATE TABLE tcgplayer_products (product_id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL,
  number TEXT NOT NULL, rarity TEXT NOT NULL, image_url TEXT NOT NULL);
CREATE INDEX tcgplayer_products_number ON tcgplayer_products(number COLLATE NOCASE);
`

/**
 * Art variants TCGplayer sells under one code and rarity (overframes, coloured foils): product names
 * are kept to tell them apart, and each variant becomes its own printing tied to its product.
 * The catalog is cleared so the next refresh refetches every set with names.
 */
export const SCHEMA_V6 = `
ALTER TABLE tcgplayer_products ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE card_printings ADD COLUMN tcg_product_id INTEGER;
DELETE FROM tcgplayer_products;
DELETE FROM tcgplayer_groups;
DELETE FROM meta WHERE key = 'tcgplayer_synced_at';
`

/**
 * Official pack renders for English sets, keyed by name since English set rows are rebuilt; and
 * the variant a printing's TCGplayer product names ("Extended Art"), shown after its rarity.
 */
export const SCHEMA_V7 = `
CREATE TABLE pack_art (set_name TEXT PRIMARY KEY, image_url TEXT NOT NULL, image_key TEXT NOT NULL UNIQUE);
ALTER TABLE card_printings ADD COLUMN variant TEXT;
DELETE FROM meta WHERE key = 'tcgplayer_synced_at';
`

/** Official English set logos from Yugipedia ("PHNI-LogoEN.png"), keyed by name like pack_art. */
export const SCHEMA_V8 = `
CREATE TABLE set_logos (set_name TEXT PRIMARY KEY, image_url TEXT NOT NULL, image_key TEXT NOT NULL UNIQUE);
`

/** English set logos from Konami's news announcements, for sets Yugipedia has no logo for. */
export const SCHEMA_V9 = `
CREATE TABLE konami_logos (set_name TEXT PRIMARY KEY, image_url TEXT NOT NULL, image_key TEXT NOT NULL UNIQUE);
`

/** A printing's rarity as shown: "Starlight Rare (Extended Art)" for a labelled variant. */
export const RARITY_LABEL = "p.set_rarity || COALESCE(' (' || p.variant || ')', '')"

/** Ordered schema steps. Append new versions to the end; never edit a shipped step. */
const MIGRATIONS: Migration[] = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: SCHEMA_V2 },
  { version: 3, sql: SCHEMA_V3, foreignKeysOff: true },
  { version: 4, sql: SCHEMA_V4 },
  { version: 5, sql: SCHEMA_V5 },
  { version: 6, sql: SCHEMA_V6 },
  { version: 7, sql: SCHEMA_V7 },
  { version: 8, sql: SCHEMA_V8 },
  { version: 9, sql: SCHEMA_V9 }
]

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
