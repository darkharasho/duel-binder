import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, migrate, SCHEMA_V1, SCHEMA_V2 } from '../../src/main/db/database'
import { getMeta, setMeta } from '../../src/main/db/meta'

describe('database', () => {
  test('migrate sets user_version 4 and is idempotent', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(4)
    expect(() => migrate(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(4)
    db.close()
  })

  test('migrates a v2 database with an entry to the latest version keeping ids', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA_V1)
    db.exec(SCHEMA_V2)
    db.pragma('user_version = 2')
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'desc', '2026-10-23')`
    ).run()
    db.prepare(
      `INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity)
       VALUES (7, 1, 'Legend of Blue Eyes White Dragon', 'LOB-EN005', 'Ultra Rare')`
    ).run()
    db.prepare(`INSERT INTO card_images (image_id, card_id, sort_order) VALUES (1, 1, 0)`).run()
    db.prepare(
      `INSERT INTO collection_entries (id, printing_id, image_id, quantity, created_at, updated_at)
       VALUES (3, 7, 1, 2, '2026-10-23', '2026-10-23')`
    ).run()
    db.prepare(`INSERT INTO sets (set_name, set_code) VALUES ('Legend of Blue Eyes White Dragon', 'LOB')`).run()
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(4)
    expect(db.prepare('SELECT id, language FROM card_printings').all()).toEqual([{ id: 7, language: 'en' }])
    expect(db.prepare('SELECT id, printing_id FROM collection_entries').all()).toEqual([
      { id: 3, printing_id: 7 }
    ])
    expect(db.prepare('SELECT language, set_name FROM sets').all()).toEqual([
      { language: 'en', set_name: 'Legend of Blue Eyes White Dragon' }
    ])
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('foreign_key_check')).toEqual([])
    db.close()
  })

  test('allows the same card, rarity and empty code in two non-English sets', () => {
    const db = openDatabase(':memory:')
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'desc', '2026-10-23')`
    ).run()
    const insert = db.prepare(
      `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
       VALUES (1, 'ja', ?, '', 'Ultra Rare')`
    )
    insert.run('Vol.1')
    insert.run('Vol.2')
    expect(() => insert.run('Vol.1')).toThrow(/UNIQUE/)
    db.close()
  })

  test('creates the sets table', () => {
    const db = openDatabase(':memory:')
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sets'").get()).toBeTruthy()
    db.close()
  })

  test('migrates a v1 database to the latest version keeping rows', () => {
    const db = new Database(':memory:')
    db.exec(SCHEMA_V1)
    db.pragma('user_version = 1')
    db.prepare("INSERT INTO meta (key, value) VALUES ('k', 'v')").run()
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(4)
    expect(db.prepare('SELECT value FROM meta WHERE key = ?').get('k')).toEqual({ value: 'v' })
    expect(db.prepare('SELECT count(*) AS n FROM sets').get()).toEqual({ n: 0 })
    db.close()
  })

  test('foreign keys are enforced', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db
        .prepare(
          `INSERT INTO collection_entries (printing_id, image_id, quantity, created_at, updated_at)
           VALUES (999, 999, 1, '2026-10-23', '2026-10-23')`
        )
        .run()
    ).toThrow(/FOREIGN KEY/)
    db.close()
  })

  test('quantity check rejects 0', () => {
    const db = openDatabase(':memory:')
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'desc', '2026-10-23')`
    ).run()
    db.prepare(
      `INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity)
       VALUES (1, 1, 'Set', 'SET-001', 'Ultra Rare')`
    ).run()
    db.prepare(`INSERT INTO card_images (image_id, card_id, sort_order) VALUES (1, 1, 0)`).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO collection_entries (printing_id, image_id, quantity, created_at, updated_at)
           VALUES (1, 1, 0, '2026-10-23', '2026-10-23')`
        )
        .run()
    ).toThrow(/CHECK/)
    db.close()
  })

  test('migration creates the card_images lookup index', () => {
    const db = openDatabase(':memory:')
    const cols = db.pragma('index_info(idx_images_card)') as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual(['card_id', 'sort_order'])
    db.close()
  })

  test('v3 replaces the set_name index with a (language, set) covering index', () => {
    const db = new Database(':memory:')
    db.exec(SCHEMA_V1)
    db.pragma('user_version = 1')
    migrate(db)
    const cols = db.pragma('index_info(idx_printings_lang_set)') as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual(['language', 'set_name', 'card_id', 'set_rarity'])
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_printings_set_name'").get()
    ).toBeUndefined()
    db.close()
  })

  test('meta round-trips', () => {
    const db = openDatabase(':memory:')
    setMeta(db, 'last_sync_at', '2026-10-23T00:00:00Z')
    expect(getMeta(db, 'last_sync_at')).toBe('2026-10-23T00:00:00Z')
    expect(getMeta(db, 'db_version')).toBeNull()
    db.close()
  })
})

describe('openDatabase failure', () => {
  test('closes the handle when migration throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ygo-db-'))
    try {
      const file = join(dir, 'collection.db')
      const pre = new Database(file)
      pre.exec('CREATE TABLE cards (x INTEGER)') // makes SCHEMA_V1 fail
      pre.close()
      const close = vi.spyOn(Database.prototype, 'close')
      expect(() => openDatabase(file)).toThrow(/already exists/)
      expect(close).toHaveBeenCalledTimes(1)
      close.mockRestore()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('v4 adds printing_art, which goes away with its printing', () => {
  const db = openDatabase(':memory:')
  db.prepare(
    "INSERT INTO cards (id, name, type, frame_type, race, \"desc\", updated_at) VALUES (1, 'A', 't', 'normal', 'r', '', 'x')"
  ).run()
  const p = db
    .prepare("INSERT INTO card_printings (card_id, set_name, set_code, set_rarity) VALUES (1, 'S', 'S-001', 'Common')")
    .run().lastInsertRowid
  db.prepare("INSERT INTO printing_art (printing_id, url, checked_at) VALUES (?, NULL, 'now')").run(p)
  db.prepare('DELETE FROM card_printings WHERE id = ?').run(p)
  expect(db.prepare('SELECT count(*) AS n FROM printing_art').get()).toEqual({ n: 0 })
})
