import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, migrate, MIGRATIONS, SCHEMA_V1, SCHEMA_V2 } from '../../src/main/db/database'
import { seededDb } from './helpers'
import { deleteMeta, getMeta, setMeta } from '../../src/main/db/meta'

describe('database', () => {
  it('V10 gives every printing a unique pkey', async () => {
    const db = await seededDb()
    const row = db.prepare("SELECT pkey FROM card_printings WHERE language='en' LIMIT 1").get() as { pkey: string }
    expect(row.pkey).toMatch(/^en\|\d+\|.+\|.+$/)
    const c = db.prepare('SELECT count(DISTINCT pkey) AS d, count(*) AS n FROM card_printings').get() as { d: number; n: number }
    expect(c.n).toBeGreaterThan(0)
    expect(c.d).toBe(c.n)
    db.close()
  })

  test('V22 retries every stored scan miss and keeps found scans', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (const m of MIGRATIONS.slice(0, 21)) db.exec(m.sql)
    db.pragma('user_version = 21')
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES
       (1, 'Nekogal #1', 'Normal Monster', 'normal', 'Beast', 'd', '2026-10-23'),
       (2, 'Maliss <P> Dormouse', 'Effect Monster', 'effect', 'Cyberse', 'd', '2026-10-23'),
       (3, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'd', '2026-10-23')`
    ).run()
    db.prepare(
      `INSERT INTO card_printings (id, card_id, language, set_name, set_code, set_rarity) VALUES
       (10, 1, 'en', 'Metal Raiders', 'MRD-EN001', 'Common'),
       (11, 1, 'en', 'Legend of Blue Eyes White Dragon', 'LOB-EN001', 'Common'),
       (20, 2, 'en', 'Alliance Insight', 'ALIN-EN001', 'Ultra Rare'),
       (30, 3, 'en', 'Legend of Blue Eyes White Dragon', 'LOB-EN005', 'Ultra Rare'),
       (31, 3, 'en', 'Starter Deck: Yugi', 'SDY-006', 'Ultra Rare')`
    ).run()
    const art = db.prepare(
      "INSERT INTO printing_art (printing_id, url, checked_at) VALUES (?, ?, '2026-10-29')"
    )
    art.run(10, null)
    art.run(11, 'https://ms.yugipedia.com/n.png')
    art.run(20, null)
    art.run(30, null)
    art.run(31, 'https://ms.yugipedia.com/dm.png')
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(33)
    const left = db.prepare('SELECT printing_id, url FROM printing_art ORDER BY printing_id').all()
    expect(left).toEqual([
      { printing_id: 11, url: 'https://ms.yugipedia.com/n.png' },
      { printing_id: 31, url: 'https://ms.yugipedia.com/dm.png' }
    ])
    db.close()
  })

  test('V21 looks up Monochrome Manga-Style printing photos again, and only those', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (const m of MIGRATIONS.slice(0, 20)) db.exec(m.sql)
    db.pragma('user_version = 20')
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'Zoa', 'Normal Monster', 'normal', 'Fiend', 'desc', '2026-10-23')`
    ).run()
    db.prepare(
      `INSERT INTO card_printings (id, card_id, language, set_name, set_code, set_rarity, variant) VALUES
       (7, 1, 'ja', 'Original Artwork Collection', '', 'Ultra Rare', 'Manga-Style, Color'),
       (8, 1, 'ja', 'Original Artwork Collection', '', 'Ultra Rare (Manga-Style, Monochrome)', NULL),
       (9, 1, 'ja', 'Original Artwork Collection', '', 'Secret Rare', 'Manga-Style, Monochrome')`
    ).run()
    const art = db.prepare("INSERT INTO printing_art (printing_id, url, checked_at) VALUES (?, 'https://x/c.png', 'x')")
    for (const id of [7, 8, 9]) art.run(id)
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(33)
    expect(db.prepare('SELECT printing_id FROM printing_art').all()).toEqual([{ printing_id: 7 }])
    db.close()
  })

  test('V11 forces a non-English re-sync and retries printing art misses', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (const m of MIGRATIONS.slice(0, 10)) db.exec(m.sql)
    db.pragma('user_version = 10')
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'desc', '2026-10-23')`
    ).run()
    db.prepare(
      `INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity) VALUES
       (7, 1, 'Legend of Blue Eyes White Dragon', 'LOB-EN005', 'Ultra Rare'),
       (8, 1, 'Starter Deck: Yugi', 'SDY-006', 'Ultra Rare')`
    ).run()
    const ids = [7, 8]
    setMeta(db, 'intl_sets_synced_at', '2026-10-01T00:00:00.000Z')
    setMeta(db, 'tcgplayer_synced_at', '2026-10-01T00:00:00.000Z')
    const art = db.prepare('INSERT INTO printing_art (printing_id, url, checked_at) VALUES (?, ?, ?)')
    art.run(ids[0], null, '2026-10-01')
    art.run(ids[1], 'https://x/y.png', '2026-10-01')
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(33)
    expect(getMeta(db, 'intl_sets_synced_at')).toBeNull()
    expect(getMeta(db, 'tcgplayer_synced_at')).toBe('2026-10-01T00:00:00.000Z')
    expect(db.prepare('SELECT printing_id, url FROM printing_art').all()).toEqual([
      { printing_id: ids[1], url: 'https://x/y.png' }
    ])
    db.close()
  })

  test('V12 gives every entry a uuid, owner 0 and dirty', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (const m of MIGRATIONS.slice(0, 11)) db.exec(m.sql)
    db.pragma('user_version = 11')
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (1, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'desc', '2026-10-23')`
    ).run()
    db.prepare(
      `INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity) VALUES
       (7, 1, 'Legend of Blue Eyes White Dragon', 'LOB-EN005', 'Ultra Rare'),
       (8, 1, 'Starter Deck: Yugi', 'SDY-006', 'Ultra Rare')`
    ).run()
    db.prepare('INSERT INTO card_images (image_id, card_id, sort_order) VALUES (1, 1, 0)').run()
    const insert = db.prepare(
      'INSERT INTO collection_entries (id, printing_id, image_id, quantity, notes, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)'
    )
    insert.run(5, 7, 2, 'first', '2026-10-01', '2026-10-02')
    insert.run(9, 8, 3, '', '2026-10-03', '2026-10-04')
    db.prepare("INSERT INTO value_snapshots (date, total_value, total_cards) VALUES ('2026-10-04', 12.5, 5)").run()
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(33)
    const rows = db
      .prepare(
        'SELECT id, uid, owner_id, dirty, deleted_at, quantity, notes, created_at, updated_at FROM collection_entries ORDER BY id'
      )
      .all() as { uid: string; [col: string]: unknown }[]
    for (const r of rows) {
      expect(r.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
    expect(rows[0].uid).not.toBe(rows[1].uid)
    expect(rows.map((r) => ({ ...r, uid: undefined }))).toEqual([
      { id: 5, uid: undefined, owner_id: 0, dirty: 1, deleted_at: null, quantity: 2, notes: 'first', created_at: '2026-10-01', updated_at: '2026-10-02' },
      { id: 9, uid: undefined, owner_id: 0, dirty: 1, deleted_at: null, quantity: 3, notes: '', created_at: '2026-10-03', updated_at: '2026-10-04' }
    ])
    expect(db.prepare('SELECT * FROM value_snapshots').all()).toEqual([
      { owner_id: 0, game: 'ygo', date: '2026-10-04', total_value: 12.5, total_cards: 5 }
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
    db.close()
  })

  test('V12 allows a tombstone beside a live entry and one live entry per owner', async () => {
    const db = await seededDb()
    const p = db.prepare('SELECT id, card_id FROM card_printings ORDER BY id LIMIT 1').get() as {
      id: number
      card_id: number
    }
    const img = (db.prepare('SELECT image_id FROM card_images WHERE card_id = ? LIMIT 1').get(p.card_id) as {
      image_id: number
    }).image_id
    const insert = db.prepare(
      `INSERT INTO collection_entries (uid, owner_id, printing_id, image_id, quantity, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 1, 'x', 'x', ?)`
    )
    insert.run('u-live', 0, p.id, img, null)
    insert.run('u-dead', 0, p.id, img, '2026-10-24')
    insert.run('u-other', 7, p.id, img, null)
    expect(() => insert.run('u-dup', 0, p.id, img, null)).toThrow(/UNIQUE/)
    db.close()
  })

  it('V15 adds remote_id, contributed, catalog_staging and sync_issues on the desktop', () => {
    const db = openDatabase(':memory:')
    const cols = (t: string): string[] =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('card_printings')).toEqual(expect.arrayContaining(['contributed', 'remote_id']))
    expect(cols('catalog_staging')).toEqual(['seq', 'tbl', 'row'])
    expect(cols('sync_issues')).toEqual(['owner_id', 'uid', 'pkey', 'reason', 'since'])
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='ix_printings_remote'").get()
    expect(idx).toBeTruthy()
    db.close()
  })

  it('V26 finds a printing by card without reading the table', () => {
    const db = openDatabase(':memory:')
    const plan = db
      .prepare("EXPLAIN QUERY PLAN SELECT id FROM card_printings WHERE game = 'pkm' AND card_id = 1 ORDER BY id")
      .all() as { detail: string }[]
    expect(plan.map((p) => p.detail).join(' ')).toContain('ix_printings_card')
    db.close()
  })

  test('migrate sets user_version 33 and is idempotent', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(33)
    expect(() => migrate(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(33)
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
    expect(db.pragma('user_version', { simple: true })).toBe(33)
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
    expect(db.pragma('user_version', { simple: true })).toBe(33)
    expect(db.prepare('SELECT value FROM meta WHERE key = ?').get('k')).toEqual({ value: 'v' })
    expect(db.prepare('SELECT count(*) AS n FROM sets').get()).toEqual({ n: 0 })
    db.close()
  })

  test('foreign keys are enforced', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db
        .prepare(
          `INSERT INTO collection_entries (uid, printing_id, image_id, quantity, created_at, updated_at)
           VALUES ('u-1', 999, 999, 1, '2026-10-23', '2026-10-23')`
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
          `INSERT INTO collection_entries (uid, printing_id, image_id, quantity, created_at, updated_at)
           VALUES ('u-1', 1, 1, 0, '2026-10-23', '2026-10-23')`
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

  test('deleteMeta removes a key and ignores a missing one', () => {
    const db = openDatabase(':memory:')
    setMeta(db, 'cloud_active_owner', '7')
    setMeta(db, 'last_sync_at', 'kept')
    deleteMeta(db, 'cloud_active_owner')
    expect(getMeta(db, 'cloud_active_owner')).toBeNull()
    expect(getMeta(db, 'last_sync_at')).toBe('kept')
    expect(() => deleteMeta(db, 'cloud_user')).not.toThrow()
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
