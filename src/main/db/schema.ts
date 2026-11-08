export interface Migration {
  version: number
  sql: string
  /** Run with foreign keys off (needed to rebuild a referenced table); checked before commit. */
  foreignKeysOff?: true
  /** SQL the portal runs instead of `sql`, or false to skip it there; absent means the same SQL. */
  server?: string | false
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
export const SCHEMA_V3 = `
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

/**
 * A printing's natural key, mirroring the two partial unique indexes from V3 (English keys omit the set
 * name), so the portal and desktop can address the same printing without sharing row ids.
 */
export const SCHEMA_V10 = `
ALTER TABLE card_printings ADD COLUMN pkey TEXT GENERATED ALWAYS AS (CASE WHEN language = 'en' THEN 'en|' || card_id || '|' || set_code || '|' || set_rarity ELSE language || '|' || card_id || '|' || set_name || '|' || set_code || '|' || set_rarity END) VIRTUAL;
CREATE UNIQUE INDEX ux_printings_pkey ON card_printings(pkey);
`

/**
 * Non-English lists now keep art variants (overframes, Manga-Style) and uncoded printings find their
 * scans: re-sync those sets on next launch, and retry printing art lookups that found nothing.
 */
export const SCHEMA_V11 = `
DELETE FROM meta WHERE key = 'intl_sets_synced_at';
DELETE FROM printing_art WHERE url IS NULL;
`

/**
 * Cloud sync: each entry gets a uuid, an owner (0 = this computer's own collection, otherwise a
 * cloud account), tombstone and dirty columns, and live-only uniqueness per owner. Snapshots are
 * kept per owner. sync_pending holds remote rows whose printing isn't in the local catalog yet;
 * cloud_accounts holds each signed-in account's pull cursor. The server has its own shape for
 * these tables, so this step is desktop-only (see server-2).
 */
export const SCHEMA_V12 = `
CREATE TABLE collection_entries_new (id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, owner_id INTEGER NOT NULL DEFAULT 0,
  printing_id INTEGER NOT NULL REFERENCES card_printings(id), image_id INTEGER NOT NULL REFERENCES card_images(image_id),
  quantity INTEGER NOT NULL CHECK (quantity >= 1), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 1);
INSERT INTO collection_entries_new (id, uid, printing_id, image_id, quantity, notes, created_at, updated_at)
  SELECT id, lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
    || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    printing_id, image_id, quantity, notes, created_at, updated_at FROM collection_entries;
DROP TABLE collection_entries;
ALTER TABLE collection_entries_new RENAME TO collection_entries;
CREATE UNIQUE INDEX ux_entries_live ON collection_entries(owner_id, printing_id, image_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_entries_dirty ON collection_entries(owner_id) WHERE dirty = 1;
CREATE TABLE value_snapshots_new (owner_id INTEGER NOT NULL DEFAULT 0, date TEXT NOT NULL, total_value REAL NOT NULL,
  total_cards INTEGER NOT NULL, PRIMARY KEY (owner_id, date));
INSERT INTO value_snapshots_new (date, total_value, total_cards) SELECT date, total_value, total_cards FROM value_snapshots;
DROP TABLE value_snapshots;
ALTER TABLE value_snapshots_new RENAME TO value_snapshots;
CREATE TABLE sync_pending (owner_id INTEGER NOT NULL, uid TEXT NOT NULL, pkey TEXT NOT NULL, entry TEXT NOT NULL,
  received_at TEXT NOT NULL, PRIMARY KEY (owner_id, uid));
CREATE TABLE cloud_accounts (owner_id INTEGER PRIMARY KEY, name TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, synced_at TEXT);
`

/**
 * TCGplayer market prices (via TCGCSV): one per product, picked across editions, with when each
 * set's prices were last fetched (local only); and each English printing's resolved price, shared
 * with the portal.
 */
export const SCHEMA_V13 = `
CREATE TABLE tcgplayer_price_groups (group_id INTEGER PRIMARY KEY, fetched_at TEXT NOT NULL);
CREATE TABLE tcgplayer_prices (product_id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, price REAL NOT NULL);
CREATE INDEX tcgplayer_prices_group ON tcgplayer_prices(group_id);
ALTER TABLE card_printings ADD COLUMN market_price REAL;
`

/**
 * TCGplayer set names, so English printings YGOPRODeck leaves out can be added under their set.
 * Sets stored before this have a NULL name, which makes the catalog refresh on the next start.
 */
export const SCHEMA_V14 = `
ALTER TABLE tcgplayer_groups ADD COLUMN name TEXT;
`

/**
 * Server-fed catalog: `contributed` marks printings a user added (the server keeps it too, see
 * server-6), `remote_id` is the server's id for a printing. catalog_staging buffers rows pulled
 * from the server's change feed until they are applied; sync_issues lists collection entries that
 * could not be matched to a printing.
 */
export const SCHEMA_V15 = `
ALTER TABLE card_printings ADD COLUMN contributed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_printings ADD COLUMN remote_id INTEGER;
CREATE INDEX ix_printings_remote ON card_printings(remote_id);
CREATE TABLE catalog_staging (seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, row TEXT NOT NULL);
CREATE TABLE sync_issues (owner_id INTEGER NOT NULL, uid TEXT NOT NULL, pkey TEXT NOT NULL, reason TEXT NOT NULL,
  since TEXT NOT NULL, PRIMARY KEY (owner_id, uid));
`

/** The server only needs the contributed flag; remote ids and staging are desktop-side. */
export const SCHEMA_V15_SERVER = `
ALTER TABLE card_printings ADD COLUMN contributed INTEGER NOT NULL DEFAULT 0;
`

/**
 * Rip (simulated pack openings): local history only, never synced. Pulls keep a snapshot of the
 * card (no foreign key to the catalog) so history survives a catalog refresh. No prices.
 * Rip has been removed; the tables stay (shipped step, and old databases keep their rows) but
 * nothing reads or writes them.
 */
export const SCHEMA_V16 = `
CREATE TABLE rip_sessions (id INTEGER PRIMARY KEY, set_name TEXT NOT NULL, set_code TEXT NOT NULL,
  pack_count INTEGER NOT NULL, started_at TEXT NOT NULL);
CREATE TABLE rip_pulls (session_id INTEGER NOT NULL REFERENCES rip_sessions(id) ON DELETE CASCADE,
  pack INTEGER NOT NULL, slot INTEGER NOT NULL, pkey TEXT NOT NULL, card_id INTEGER NOT NULL,
  name TEXT NOT NULL, set_code TEXT NOT NULL, rarity TEXT NOT NULL, variant TEXT, frame_type TEXT NOT NULL,
  image_id INTEGER, PRIMARY KEY (session_id, pack, slot));
CREATE INDEX ix_rip_pulls_rarity ON rip_pulls(rarity);
`

/**
 * Printings someone asked to have priced (eBay, see src/main/prices/candidates). On the portal: any
 * user's request, so the price alarm prices printings nobody owns yet. On a desktop or phone: what
 * this device asked for, so it doesn't ask again for a while and its sync pulls their prices.
 */
export const SCHEMA_V17 = `
CREATE TABLE price_requests (printing_id INTEGER PRIMARY KEY REFERENCES card_printings(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL);
CREATE INDEX ix_price_requests_at ON price_requests(requested_at);
`

/**
 * Entries by printing, for "does anyone own this printing" (src/main/prices/candidates). Without it each
 * sync's price lookup scanned the collection once per catalog printing, freezing the app for seconds to
 * minutes. The portal has had the same index since server-2, hence `server: false`.
 */
export const SCHEMA_V18 = `
CREATE INDEX ix_entries_printing_live ON collection_entries(printing_id) WHERE deleted_at IS NULL;
`

/**
 * Multi-game: every catalog row, entry and snapshot belongs to a game ('ygo' or 'pkm'; anything
 * older is Yu-Gi-Oh!). The referenced tables only gain a column; `sets` and `value_snapshots`,
 * which no foreign key references, are rebuilt with the game in their key. `pokemon_cards` holds
 * the Pokémon-only card fields, and `cloud_game_cursors` the pull cursors of games after the first
 * (Yu-Gi-Oh! keeps `cloud_accounts.cursor` and its price cursor). The server has its own shape for
 * entries and snapshots, so this step is desktop-only; server-12 runs SCHEMA_V19_SERVER.
 */
export const SCHEMA_V19 = `
ALTER TABLE cards ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';
ALTER TABLE card_images ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';
ALTER TABLE card_printings ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';
ALTER TABLE collection_entries ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';
CREATE TABLE sets_new (game TEXT NOT NULL DEFAULT 'ygo', language TEXT NOT NULL DEFAULT 'en', set_name TEXT NOT NULL,
  set_code TEXT NOT NULL, tcg_date TEXT, image_url TEXT, image_key TEXT, list_rows INTEGER, unmatched_rows INTEGER,
  PRIMARY KEY (game, language, set_name));
INSERT INTO sets_new (language, set_name, set_code, tcg_date, image_url, image_key, list_rows, unmatched_rows)
  SELECT language, set_name, set_code, tcg_date, image_url, image_key, list_rows, unmatched_rows FROM sets;
DROP TABLE sets;
ALTER TABLE sets_new RENAME TO sets;
CREATE TABLE value_snapshots_new (owner_id INTEGER NOT NULL DEFAULT 0, game TEXT NOT NULL DEFAULT 'ygo', date TEXT NOT NULL,
  total_value REAL NOT NULL, total_cards INTEGER NOT NULL, PRIMARY KEY (owner_id, game, date));
INSERT INTO value_snapshots_new (owner_id, date, total_value, total_cards)
  SELECT owner_id, date, total_value, total_cards FROM value_snapshots;
DROP TABLE value_snapshots;
ALTER TABLE value_snapshots_new RENAME TO value_snapshots;
CREATE TABLE pokemon_cards (card_id INTEGER PRIMARY KEY REFERENCES cards(id), category TEXT NOT NULL, hp INTEGER,
  types TEXT NOT NULL DEFAULT '[]', stage TEXT, rarity TEXT, illustrator TEXT, source_id TEXT NOT NULL UNIQUE);
CREATE TABLE cloud_game_cursors (owner_id INTEGER NOT NULL, game TEXT NOT NULL, stream TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner_id, game, stream));
`

/**
 * The server's V19, run as part of server-12 (after server-6 added `catalog_seq`, which the `sets`
 * rebuild keeps, so no row looks changed). Snapshots key on `user_id`; no cloud cursors. Frozen:
 * server-12 has shipped once deployed.
 */
export const SCHEMA_V19_SERVER = `
ALTER TABLE cards ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';
ALTER TABLE card_images ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';
ALTER TABLE card_printings ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';
ALTER TABLE collection_entries ADD COLUMN game TEXT NOT NULL DEFAULT 'ygo';
CREATE TABLE sets_new (game TEXT NOT NULL DEFAULT 'ygo', language TEXT NOT NULL DEFAULT 'en', set_name TEXT NOT NULL,
  set_code TEXT NOT NULL, tcg_date TEXT, image_url TEXT, image_key TEXT, list_rows INTEGER, unmatched_rows INTEGER,
  catalog_seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game, language, set_name));
INSERT INTO sets_new (language, set_name, set_code, tcg_date, image_url, image_key, list_rows, unmatched_rows, catalog_seq)
  SELECT language, set_name, set_code, tcg_date, image_url, image_key, list_rows, unmatched_rows, catalog_seq FROM sets;
DROP TABLE sets;
ALTER TABLE sets_new RENAME TO sets;
CREATE INDEX ix_sets_catalog_seq ON sets(catalog_seq);
CREATE TABLE value_snapshots_new (user_id INTEGER NOT NULL REFERENCES users(id), game TEXT NOT NULL DEFAULT 'ygo',
  date TEXT NOT NULL, total_value REAL NOT NULL, total_cards INTEGER NOT NULL, PRIMARY KEY (user_id, game, date));
INSERT INTO value_snapshots_new (user_id, date, total_value, total_cards)
  SELECT user_id, date, total_value, total_cards FROM value_snapshots;
DROP TABLE value_snapshots;
ALTER TABLE value_snapshots_new RENAME TO value_snapshots;
CREATE TABLE pokemon_cards (card_id INTEGER PRIMARY KEY REFERENCES cards(id), category TEXT NOT NULL, hp INTEGER,
  types TEXT NOT NULL DEFAULT '[]', stage TEXT, rarity TEXT, illustrator TEXT, source_id TEXT NOT NULL UNIQUE,
  catalog_seq INTEGER NOT NULL DEFAULT 0);
CREATE INDEX ix_pokemon_cards_catalog_seq ON pokemon_cards(catalog_seq);
`

/**
 * Pokémon catalog: an image URL and the card's name in its own language. Desktop-only: a fresh
 * server runs desktop steps before server-12 creates `pokemon_cards`, so server-13 repeats this.
 */
export const SCHEMA_V20 = `
ALTER TABLE pokemon_cards ADD COLUMN image_url TEXT;
ALTER TABLE pokemon_cards ADD COLUMN local_name TEXT;
`

/**
 * Manga-Style printings now come as Color and Monochrome. An app from before took the colour scan
 * for any Manga-Style printing, so a Monochrome one it looked up shows the colour photo: look
 * those up again.
 */
export const SCHEMA_V21 = `
DELETE FROM printing_art WHERE printing_id IN
  (SELECT id FROM card_printings WHERE set_rarity LIKE '%Monochrome)' OR variant LIKE '%Monochrome');
`

/**
 * Printing scans of a card whose name holds a character MediaWiki can't title a page with
 * (# < > [ ] { } |: "Nekogal #1", "Maliss <P> Dormouse") were looked up under the wrong gallery
 * title and stored as "no scan". And a gallery titled "Name (card)" was never asked for, since a
 * missing plain gallery came back as an empty one. Those misses can't be told apart by name, so
 * every stored miss is looked up again (lazily, as printings are shown); found scans are kept.
 */
export const SCHEMA_V22 = `
DELETE FROM printing_art WHERE url IS NULL;
`

/**
 * Pokémon set art the nightly job matches: booster pack images from the Bulbagarden Archives
 * (kind 'pack', one row per design, sort_order 0 the main one) and set logos from the Pokémon TCG
 * API for sets TCGdex has none for (kind 'logo'). Keyed by set name like `sets`, whose Pokémon
 * names never change once written. The server adds its change-feed columns in server-14.
 */
export const SCHEMA_V23 = `
CREATE TABLE pokemon_set_art (language TEXT NOT NULL, set_name TEXT NOT NULL, kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL, image_url TEXT NOT NULL, image_key TEXT NOT NULL,
  PRIMARY KEY (language, set_name, kind, sort_order));
CREATE INDEX ix_pokemon_set_art_key ON pokemon_set_art(image_key);
`

/** One AFTER INSERT, DELETE and UPDATE trigger on `table`; `cols` are what a rollup reads (see V24). */
const rollupTriggers = (table: string, cols?: string[]): string => {
  const guard = cols ? ` WHEN ${cols.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ')}` : ''
  return ['INSERT', 'DELETE', 'UPDATE']
    .map(
      (op) =>
        `CREATE TRIGGER rollup_${table}_${op.toLowerCase()} AFTER ${op} ON ${table}${
          op === 'UPDATE' ? guard : ''
        } BEGIN DELETE FROM catalog_rollups; END;`
    )
    .join('\n')
}

/**
 * Per-game results that only the catalog decides and that take hundreds of ms over a full catalog
 * (src/main/repo/rollup.ts); better-sqlite3 runs on the main process, so those were UI freezes.
 * A write to anything a rollup reads drops every rollup in the same transaction, whoever writes.
 * Price columns are left out of the triggers: they change daily and no rollup reads them.
 * Desktop and phone only. A later step that rebuilds one of these tables must recreate its triggers.
 */
export const SCHEMA_V24 = `
CREATE TABLE catalog_rollups (key TEXT PRIMARY KEY, value TEXT NOT NULL);
${rollupTriggers('card_printings', ['language', 'set_name', 'set_code', 'set_rarity', 'card_id', 'game', 'contributed', 'missing_from_api'])}
${rollupTriggers('card_images', ['image_id', 'card_id', 'sort_order', 'game'])}
${rollupTriggers('cards', ['type', 'attribute', 'race', 'archetype', 'game'])}
${rollupTriggers('pokemon_cards', ['card_id', 'category', 'types', 'stage', 'rarity'])}
${rollupTriggers('sets')}
${rollupTriggers('pack_art')}
${rollupTriggers('set_logos')}
${rollupTriggers('konami_logos')}
${rollupTriggers('pokemon_set_art')}
`

/**
 * Wishlist: the cards an owner wants, one row per printing. Keyed by `pkey`, with no foreign key: a
 * want can outlive its printing's row (a catalog refresh, the phone's catalog reset) and show again
 * when the printing does, so it needs no sync_pending. `quantity` is the copies wanted, NULL for no
 * target. The server has its own shape, so this step is desktop-only (see server-15).
 */
export const SCHEMA_V25 = `
CREATE TABLE wishlist_entries (owner_id INTEGER NOT NULL DEFAULT 0, pkey TEXT NOT NULL, game TEXT NOT NULL DEFAULT 'ygo',
  quantity INTEGER CHECK (quantity >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (owner_id, pkey));
CREATE INDEX ix_wishlist_dirty ON wishlist_entries(owner_id) WHERE dirty = 1;
`

/**
 * A card's printings. The unique indexes that lead with card_id are partial, so a lookup that
 * names no language read the whole table: the catalog job did that once per Pokémon card, which
 * was most of its run time. Desktop-only: the server has its own indexes.
 */
export const SCHEMA_V26 = `
CREATE INDEX ix_printings_card ON card_printings(card_id);
`

/**
 * The English card whose art a Pokémon card with none of its own shows, under an "English art"
 * label. A link rather than a copy in `image_url`: stored art sticks and is what the scanner
 * fingerprints. Older clients ignore the column and keep the placeholder. Desktop-only for the same
 * reason as V20: server-16 repeats this.
 */
export const SCHEMA_V27 = `
ALTER TABLE pokemon_cards ADD COLUMN art_twin_id INTEGER;
CREATE INDEX ix_pokemon_cards_art_twin ON pokemon_cards(card_id) WHERE art_twin_id IS NOT NULL;
`

/**
 * The Traditional Chinese card whose art a Pokémon card with none of its own shows, under a
 * "Traditional Chinese art" label, ahead of `art_twin_id`. Its own column because older clients
 * call anything in `art_twin_id` English: they ignore this one and keep the English twin, or the
 * placeholder. Desktop-only for the same reason as V27: server-18 repeats this.
 */
export const SCHEMA_V28 = `
ALTER TABLE pokemon_cards ADD COLUMN traditional_twin_id INTEGER;
CREATE INDEX ix_pokemon_cards_traditional_twin ON pokemon_cards(card_id) WHERE traditional_twin_id IS NOT NULL;
`

/**
 * Yugipedia moved its file URLs to another host, which read as "no scan" for every lookup since
 * and stuck for 30 days: look those up again. The server needs this too.
 */
export const SCHEMA_V29 = `
DELETE FROM printing_art WHERE url IS NULL;
`

/** Binders: a named subset of the collection (rules, a goal, languages) and its per-card/art edits. Desktop only; the server has these as server-19. */
export const SCHEMA_V30 = `
CREATE TABLE binders (owner_id INTEGER NOT NULL DEFAULT 0, uid TEXT NOT NULL, game TEXT NOT NULL,
  name TEXT NOT NULL, rules TEXT NOT NULL, goal TEXT NOT NULL, languages TEXT NOT NULL,
  friends_visible INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (owner_id, uid));
CREATE TABLE binder_edits (owner_id INTEGER NOT NULL DEFAULT 0, binder_uid TEXT NOT NULL, level TEXT NOT NULL,
  target TEXT NOT NULL, game TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_id, binder_uid, level, target));
CREATE INDEX ix_binders_dirty ON binders(owner_id) WHERE dirty = 1;
CREATE INDEX ix_binder_edits_dirty ON binder_edits(owner_id) WHERE dirty = 1;
`

/** Illustrator lookups for binder rules. Desktop only: the server gets this index as server-21. */
export const SCHEMA_V31 = `
CREATE INDEX ix_pokemon_cards_illustrator ON pokemon_cards(illustrator);
`

/**
 * Lookups binder rules start from: a card by either name (NOCASE, as the rule compares them) or
 * archetype, and a printing by set. Desktop only: the server gets these as server-22 to server-25.
 */
export const SCHEMA_V32 = `
CREATE INDEX ix_cards_name ON cards(name COLLATE NOCASE);
CREATE INDEX ix_pokemon_cards_local_name ON pokemon_cards(local_name COLLATE NOCASE);
CREATE INDEX ix_printings_set_name ON card_printings(set_name);
CREATE INDEX ix_cards_archetype ON cards(archetype);
`

/**
 * A game's rarities, read from the index alone for the rule editor's suggestions; rarity rules start
 * from it too. Desktop only: the server gets this as server-26.
 */
export const SCHEMA_V33 = 'CREATE INDEX ix_printings_rarity ON card_printings(set_rarity, game);'

/**
 * English printings YGOPRODeck lacks are filled in from Yugipedia's TCG-EN set lists (sync/intl.ts);
 * `yugipedia` marks them, so the YGOPRODeck sync leaves them be and takes one over when it lists
 * the same printing. Re-reads the set lists so they fill in. The server gets it too, though it never
 * syncs and the catalog feed doesn't carry the column: the sync code it shares with the desktop (and
 * its tests seed with) writes the column.
 */
export const SCHEMA_V34 = `
ALTER TABLE card_printings ADD COLUMN yugipedia INTEGER NOT NULL DEFAULT 0;
DELETE FROM meta WHERE key = 'intl_sets_synced_at';
`

/**
 * The cards with a printing in a language (Browse's language filter), read from the index alone:
 * English printings are spread through the whole table, so checking `contributed` and `game` on
 * each row cost a random read per printing. Desktop only: the server gets this as server-27.
 */
export const SCHEMA_V35 =
  'CREATE INDEX ix_printings_language_card ON card_printings(language, contributed, card_id, game);'

/**
 * A set's series, the header the Sets page groups it under: "Scarlet & Violet", "Mega Evolution".
 * Pokémon only, from TCGdex, and always the English series, as set names are English. Yu-Gi-Oh!
 * has no series and leaves it NULL. Desktop-only for the same reason as V27: server-28 repeats this
 * and recreates the `sets` seq triggers over it.
 */
export const SCHEMA_V36 = 'ALTER TABLE sets ADD COLUMN series TEXT;'

/**
 * Favourites: the cards an owner hearted, one row per card (not per printing or copy), so a heart
 * shows on every printing and copy of it. Keyed by `card_id` with no foreign key, as the wishlist
 * is by pkey: a favourite can outlive its card's row (the phone's catalog reset) and shows again
 * when the card does. The server has its own shape, so this step is desktop-only (see server-29).
 */
export const SCHEMA_V37 = `
CREATE TABLE favourites (owner_id INTEGER NOT NULL DEFAULT 0, card_id INTEGER NOT NULL, game TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (owner_id, card_id));
CREATE INDEX ix_favourites_dirty ON favourites(owner_id) WHERE dirty = 1;
`

/**
 * Printing photos are chosen anew for art variants: an alternate art now takes its "-AA" scan, a
 * rarity stored abbreviated ("PlScR") its own rarity's, and an art variant with no scan of its own
 * gets none instead of the plain card's (see choosePrintingScan). Every photo stored for an art
 * variant or an abbreviated rarity is looked up again (lazily, as printings are shown), and so is
 * every stored miss. The server needs this too; its photos of these printings are kept under new
 * keys (printingPhotoKey), so the old ones are never served again.
 */
export const SCHEMA_V38 = `
DELETE FROM printing_art WHERE url IS NULL OR printing_id IN (
  SELECT id FROM card_printings
  WHERE (variant IS NOT NULL AND variant <> '') OR set_rarity LIKE '%)' OR set_rarity GLOB '*[a-z][A-Z]*'
);
`

/**
 * Every stored "no scan" is looked up again: a new set's scans reach Yugipedia over weeks, and a
 * miss stored at release was kept 30 days (MAMS's and the European RA05's overframes, among
 * others). The server needs this too: its photos are what the apps show.
 */
export const SCHEMA_V39 = `
DELETE FROM printing_art WHERE url IS NULL;
`

/**
 * One Piece (hidden game 'op'), in the Yu-Gi-Oh!-like card model on the shared tables:
 * - `cards`: one row per number per region, id `onePieceCardId('en', 'OP05-119')`, `name` the card's
 *   name. Alternate arts never get a card row.
 * - `card_images`: one row per Bandai entry, `card_id` pointing at the number's card. `OP05-119` is
 *   the base art, `OP05-119_p1` and `_p2` the parallels.
 * - `card_printings`: one row per set appearance x version. The version goes in `set_rarity` (the
 *   English pkey is `en|card_id|set_code|set_rarity`, so it is the only column that keeps two versions
 *   under one set_code apart): the rarity code, plus the version label in parentheses when the
 *   printing isn't the base art ('SR', 'SR (Alternate Art)', 'SEC (Manga)', 'SP'). `variant` stays
 *   NULL. `set_rarity` must be unique per card x set_code ('SR (Alternate Art 2)' for a second one).
 * - collection entries: pair `printing_id` with `image_id`, as Yu-Gi-Oh!'s do.
 * `onepiece_cards` holds only game text. `colors`, `attribute` and `traits` are JSON arrays.
 * `number` is the printed base number and isn't unique (Japanese has its own card per number).
 * `onepiece_images.bandai_id` is what the /img proxy builds Bandai's image URL from (a bare id is
 * English art, `ja:<id>` Japanese; see opBandaiArtUrl).
 * DON!! cards (none on Bandai's list) are one card per TCGplayer product: `number` and `set_code`
 * 'DON!!', a printing per finish (`set_rarity_code` `tcg:<product id>/<finish>`), and the image's
 * `bandai_id` `tcg:<product id>`, which /img serves from TCGplayer.
 * The server adds its change-feed columns in server-35.
 */
const ONEPIECE_TABLES = `
CREATE TABLE onepiece_cards (card_id INTEGER PRIMARY KEY REFERENCES cards(id),
  number TEXT NOT NULL, colors TEXT NOT NULL DEFAULT '[]', card_type TEXT NOT NULL,
  cost INTEGER, power INTEGER, counter INTEGER, life INTEGER,
  attribute TEXT NOT NULL DEFAULT '[]', traits TEXT NOT NULL DEFAULT '[]',
  effect TEXT, trigger TEXT, block_icon INTEGER);
CREATE INDEX ix_onepiece_cards_number ON onepiece_cards(number);
CREATE TABLE onepiece_images (image_id INTEGER PRIMARY KEY REFERENCES card_images(image_id),
  bandai_id TEXT NOT NULL);
`

export const SCHEMA_V40 = `${ONEPIECE_TABLES}
${rollupTriggers('onepiece_cards', ['card_id', 'colors', 'card_type', 'attribute', 'traits'])}
`

/**
 * Scan sessions: the cards added in one scanner "Add to collection", kept as a JSON list with the
 * prices they had then. Desktop and phone only; the server has its own table (server-38).
 */
export const SCHEMA_V41 = `
CREATE TABLE scan_sessions (owner_id INTEGER NOT NULL DEFAULT 0, uid TEXT NOT NULL, game TEXT NOT NULL,
  cards TEXT NOT NULL, friends_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (owner_id, uid));
CREATE INDEX ix_scan_sessions_dirty ON scan_sessions(owner_id) WHERE dirty = 1;
`

/**
 * Pokédex numbers on each Pokémon card: `dex_no` is the first species (NULL for Trainers, Energy and
 * unknown), `dex_extra` the other species, comma-separated ascending (e.g. '644'). Desktop and phone
 * only: server-40 repeats this SQL and recreates the seq triggers over the new columns.
 */
export const SCHEMA_V42 = `
ALTER TABLE pokemon_cards ADD COLUMN dex_no INTEGER;
ALTER TABLE pokemon_cards ADD COLUMN dex_extra TEXT;
CREATE INDEX ix_pokemon_cards_dex ON pokemon_cards(dex_no) WHERE dex_no IS NOT NULL;
CREATE INDEX ix_pokemon_cards_dex_extra ON pokemon_cards(card_id) WHERE dex_extra IS NOT NULL;
`

/**
 * Drops per-card eBay prices that one lookup put on several rarities of a code: the price Worker used
 * to count listings naming no rarity for every rarity, so RV01-KR005's Ultra, Secret and Prismatic
 * Secret all read $77.99. A group is one card, language, code and price over 2+ rarities, checked at
 * different times (per-card lookups; a set sweep stamps one time and splits by rarity). The dropped
 * rows are due again and are looked up with the rarity count. The server runs it too (server-41), or
 * it would hand the old prices back.
 */
export const SCHEMA_V43 = `
DELETE FROM intl_prices WHERE printing_id IN (
  SELECT ip.printing_id FROM intl_prices ip JOIN card_printings p ON p.id = ip.printing_id
  JOIN (SELECT p2.card_id, p2.language, p2.set_code, ip2.price
        FROM intl_prices ip2 JOIN card_printings p2 ON p2.id = ip2.printing_id
        WHERE ip2.price IS NOT NULL AND p2.game = 'ygo' AND p2.language <> 'en' AND p2.set_code <> ''
        GROUP BY p2.card_id, p2.language, p2.set_code, ip2.price
        HAVING COUNT(DISTINCT p2.set_rarity) > 1 AND MIN(ip2.checked_at) <> MAX(ip2.checked_at)) g
    ON g.card_id = p.card_id AND g.language = p.language AND g.set_code = p.set_code AND g.price = ip.price);
`

/** The server keeps rollups out, as V24 does. */
export const SCHEMA_V40_SERVER = ONEPIECE_TABLES

/** A printing's rarity as shown: "Starlight Rare (Extended Art)" for a labelled variant. */
export const RARITY_LABEL = "p.set_rarity || COALESCE(' (' || p.variant || ')', '')"

/** Ordered schema steps. Append new versions to the end; never edit a shipped step. */
export const MIGRATIONS: Migration[] = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: SCHEMA_V2 },
  { version: 3, sql: SCHEMA_V3, foreignKeysOff: true },
  { version: 4, sql: SCHEMA_V4 },
  { version: 5, sql: SCHEMA_V5 },
  { version: 6, sql: SCHEMA_V6 },
  { version: 7, sql: SCHEMA_V7 },
  { version: 8, sql: SCHEMA_V8 },
  { version: 9, sql: SCHEMA_V9 },
  { version: 10, sql: SCHEMA_V10 },
  { version: 11, sql: SCHEMA_V11 },
  { version: 12, sql: SCHEMA_V12, server: false },
  { version: 13, sql: SCHEMA_V13 },
  { version: 14, sql: SCHEMA_V14 },
  { version: 15, sql: SCHEMA_V15, server: SCHEMA_V15_SERVER },
  { version: 16, sql: SCHEMA_V16, server: false },
  { version: 17, sql: SCHEMA_V17 },
  { version: 18, sql: SCHEMA_V18, server: false },
  { version: 19, sql: SCHEMA_V19, server: false },
  { version: 20, sql: SCHEMA_V20, server: false },
  { version: 21, sql: SCHEMA_V21 },
  { version: 22, sql: SCHEMA_V22 },
  { version: 23, sql: SCHEMA_V23 },
  { version: 24, sql: SCHEMA_V24, server: false },
  { version: 25, sql: SCHEMA_V25, server: false },
  { version: 26, sql: SCHEMA_V26, server: false },
  { version: 27, sql: SCHEMA_V27, server: false },
  { version: 28, sql: SCHEMA_V28, server: false },
  { version: 29, sql: SCHEMA_V29 },
  { version: 30, sql: SCHEMA_V30, server: false },
  { version: 31, sql: SCHEMA_V31, server: false },
  { version: 32, sql: SCHEMA_V32, server: false },
  { version: 33, sql: SCHEMA_V33, server: false },
  { version: 34, sql: SCHEMA_V34 },
  { version: 35, sql: SCHEMA_V35, server: false },
  { version: 36, sql: SCHEMA_V36, server: false },
  { version: 37, sql: SCHEMA_V37, server: false },
  { version: 38, sql: SCHEMA_V38 },
  { version: 39, sql: SCHEMA_V39 },
  { version: 40, sql: SCHEMA_V40, server: SCHEMA_V40_SERVER },
  { version: 41, sql: SCHEMA_V41, server: false },
  { version: 42, sql: SCHEMA_V42, server: false },
  { version: 43, sql: SCHEMA_V43, server: false }
]
