import { openDatabase, migrate } from '../../src/main/db/database'
import { getMeta, setMeta } from '../../src/main/db/meta'

describe('database', () => {
  test('migrate sets user_version 1 and is idempotent', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(() => migrate(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(1)
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

  test('meta round-trips', () => {
    const db = openDatabase(':memory:')
    setMeta(db, 'last_sync_at', '2026-10-23T00:00:00Z')
    expect(getMeta(db, 'last_sync_at')).toBe('2026-10-23T00:00:00Z')
    expect(getMeta(db, 'db_version')).toBeNull()
    db.close()
  })
})
