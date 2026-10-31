import type Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'
import { pokemonId } from '../../src/shared/games'
import { LEGACY_CATALOG_TABLES } from '../../src/shared/catalogTables'
import { SHARED_SET_NAME, seedPokemon } from '../fixtures/pokemon'
import { databaseAt } from './helpers'

const GAME_TABLES = [
  'cards',
  'card_images',
  'card_printings',
  'sets',
  'collection_entries',
  'value_snapshots'
]

/** A version-18 database holding a few of today's Yu-Gi-Oh! fixture rows, English and Japanese. */
function v18(): Database.Database {
  const db = databaseAt(18)
  db.exec(`
    INSERT INTO cards (id, name, type, frame_type, race, attribute, level, atk, def, "desc", updated_at) VALUES
      (46986414, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'DARK', 7, 2500, 2100, 'The ultimate wizard.', '2026-10-23'),
      (89631139, 'Blue-Eyes White Dragon', 'Normal Monster', 'normal', 'Dragon', 'LIGHT', 8, 3000, 2500, 'Legendary.', '2026-10-23');
    INSERT INTO card_images (image_id, card_id, sort_order) VALUES (46986414, 46986414, 0), (36996508, 46986414, 1),
      (89631139, 89631139, 0);
    INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity, set_rarity_code, set_price, language) VALUES
      (1, 46986414, '${SHARED_SET_NAME}', 'LOB-EN005', 'Ultra Rare', '(UR)', 5.12, 'en'),
      (2, 46986414, 'Starter Deck: Yugi', 'SDY-006', 'Ultra Rare', '(UR)', 0, 'en'),
      (3, 89631139, '${SHARED_SET_NAME}', 'LOB-EN001', 'Ultra Rare', '(UR)', 20, 'en'),
      (4, 89631139, 'Vol.1', '', 'Ultra Rare', '', NULL, 'ja');
    INSERT INTO sets (language, set_name, set_code, tcg_date, image_url) VALUES
      ('en', '${SHARED_SET_NAME}', 'LOB', '2002-03-08', 'https://example/lob.jpg'),
      ('en', 'Starter Deck: Yugi', 'SDY', '2002-03-29', NULL);
    INSERT INTO sets (language, set_name, set_code, list_rows, unmatched_rows) VALUES ('ja', 'Vol.1', '', 40, 0);
    INSERT INTO collection_entries (id, uid, owner_id, printing_id, image_id, quantity, created_at, updated_at) VALUES
      (1, 'u-1', 0, 1, 46986414, 2, '2026-10-23', '2026-10-23'),
      (2, 'u-2', 7, 4, 89631139, 1, '2026-10-23', '2026-10-23');
    INSERT INTO value_snapshots (owner_id, date, total_value, total_cards) VALUES
      (0, '2026-10-22', 10.5, 2), (0, '2026-10-23', 12.25, 3), (7, '2026-10-23', 1, 1);
  `)
  return db
}

const all = (db: Database.Database, sql: string): unknown[] => db.prepare(sql).all()
const columns = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
const primaryKey = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[])
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name)

describe('migration V19 (game columns, Pokémon card fields)', () => {
  it('marks every existing row Yu-Gi-Oh! and keeps keys and rows as they were', () => {
    const db = v18()
    const pkeys = all(db, 'SELECT pkey FROM card_printings ORDER BY id')
    const sets = all(db, 'SELECT * FROM sets ORDER BY language, set_name')
    const snapshots = all(db, 'SELECT * FROM value_snapshots ORDER BY owner_id, date')
    const entries = all(db, 'SELECT * FROM collection_entries ORDER BY id')

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(24)
    for (const t of GAME_TABLES) {
      expect(columns(db, t), t).toContain('game')
      expect(all(db, `SELECT DISTINCT game FROM ${t}`), t).toEqual([{ game: 'ygo' }])
    }
    expect(all(db, 'SELECT pkey FROM card_printings ORDER BY id')).toEqual(pkeys)
    const without = (rows: unknown[]): unknown[] =>
      rows.map((r) => {
        const rest = { ...(r as Record<string, unknown>) }
        delete rest.game
        return rest
      })
    expect(without(all(db, 'SELECT * FROM sets ORDER BY language, set_name'))).toEqual(sets)
    expect(without(all(db, 'SELECT * FROM value_snapshots ORDER BY owner_id, date'))).toEqual(
      snapshots
    )
    expect(without(all(db, 'SELECT * FROM collection_entries ORDER BY id'))).toEqual(entries)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('keys sets and value snapshots by game', () => {
    const db = v18()
    migrate(db)
    expect(primaryKey(db, 'sets')).toEqual(['game', 'language', 'set_name'])
    expect(primaryKey(db, 'value_snapshots')).toEqual(['owner_id', 'game', 'date'])
    db.prepare(
      "INSERT INTO value_snapshots (owner_id, game, date, total_value, total_cards) VALUES (0, 'pkm', '2026-10-23', 3, 1)"
    ).run()
    expect(
      all(
        db,
        "SELECT game FROM value_snapshots WHERE owner_id = 0 AND date = '2026-10-23' ORDER BY game"
      )
    ).toEqual([{ game: 'pkm' }, { game: 'ygo' }])
    db.close()
  })

  it('takes Pokémon cards next to a same-named Yu-Gi-Oh! set', () => {
    const db = v18()
    migrate(db)
    const { cardIds, printingIds } = seedPokemon(db)
    expect(cardIds).toHaveLength(2)
    expect(printingIds).toHaveLength(4)
    expect(cardIds.every((id) => id >= 2 ** 40)).toBe(true)
    expect(cardIds[0]).toBe(pokemonId('sv02-045'))
    expect(
      db
        .prepare(
          "SELECT game, set_code FROM sets WHERE language = 'en' AND set_name = ? ORDER BY game"
        )
        .all(SHARED_SET_NAME)
    ).toEqual([
      { game: 'pkm', set_code: 'PAL' },
      { game: 'ygo', set_code: 'LOB' }
    ])
    expect(
      all(
        db,
        `SELECT set_code, set_rarity FROM card_printings WHERE game = 'pkm' AND language = 'en' ORDER BY id`
      )
    ).toEqual([
      { set_code: 'PAL 045/193', set_rarity: 'Normal' },
      { set_code: 'PAL 045/193', set_rarity: 'Reverse Holo' }
    ])
    expect(all(db, 'SELECT card_id, source_id FROM pokemon_cards ORDER BY source_id DESC')).toEqual(
      [
        { card_id: cardIds[0], source_id: 'sv02-045' },
        { card_id: cardIds[1], source_id: 'ja/SV2D-030' }
      ]
    )
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('adds the Pokémon card fields and per-game cloud cursors', () => {
    const db = databaseAt(19)
    expect(columns(db, 'pokemon_cards')).toEqual([
      'card_id',
      'category',
      'hp',
      'types',
      'stage',
      'rarity',
      'illustrator',
      'source_id'
    ])
    expect(columns(db, 'cloud_game_cursors')).toEqual(['owner_id', 'game', 'stream', 'cursor'])
    expect(primaryKey(db, 'cloud_game_cursors')).toEqual(['owner_id', 'game', 'stream'])
    db.prepare(
      "INSERT INTO cloud_game_cursors (owner_id, game, stream) VALUES (7, 'pkm', 'entries')"
    ).run()
    expect(all(db, 'SELECT cursor FROM cloud_game_cursors')).toEqual([{ cursor: 0 }])
    db.close()
  })

  it('the legacy catalog list is the V18 catalog', () => {
    const db = databaseAt(18)
    for (const t of LEGACY_CATALOG_TABLES) {
      const cols = columns(db, t.name).filter(
        (c) =>
          !(t.name === 'card_printings' && ['id', 'pkey', 'contributed', 'remote_id'].includes(c))
      )
      expect([...t.columns].sort(), t.name).toEqual(cols.sort())
    }
    expect(primaryKey(db, 'sets')).toEqual(
      LEGACY_CATALOG_TABLES.find((t) => t.name === 'sets')!.key
    )
    db.close()
  })
})
