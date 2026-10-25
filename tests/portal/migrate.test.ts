import Database from 'better-sqlite3'
import { MIGRATIONS } from '../../src/main/db/schema'
import { migrateServer, runSteps, SERVER_STEPS } from '../../workers/portal/src/migrate'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

const tableNames = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as { name: string }[]).map((r) => r.name)

describe('migrateServer', () => {
  it('creates the server schema and records every step', () => {
    const db = freshDb()
    migrateServer(db)
    const names = tableNames(db)
    for (const t of ['users', 'sessions', 'collection_entries', 'cards_fts']) expect(names).toContain(t)
    const cols = (db.prepare('PRAGMA table_info(collection_entries)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['user_id', 'uid', 'deleted_at']))
    const done = (db.prepare('SELECT name FROM server_migrations').all() as { name: string }[]).map((r) => r.name)
    for (let v = 1; v <= 10; v++) expect(done).toContain(`desktop-${v}`)
    expect(done).toContain('server-1')
    db.close()
  })

  it('is a no-op when run again', () => {
    const db = freshDb()
    migrateServer(db)
    const count = () => (db.prepare('SELECT count(*) AS n FROM server_migrations').get() as { n: number }).n
    const before = count()
    expect(() => migrateServer(db)).not.toThrow()
    expect(count()).toBe(before)
    db.close()
  })

  it('a desktop step marked server: false is skipped', () => {
    const db = freshDb()
    db.exec('CREATE TABLE server_migrations (name TEXT PRIMARY KEY)')
    runSteps(db, [{ version: 99, sql: 'CREATE TABLE nope(x)', server: false }])
    expect(tableNames(db)).not.toContain('nope')
    expect(db.prepare("SELECT name FROM server_migrations WHERE name = 'desktop-99'").get()).toBeTruthy()
    db.close()
  })

  it('a desktop step with foreignKeysOff and no server override is refused', () => {
    const db = freshDb()
    expect(() => runSteps(db, [{ version: 99, sql: 'CREATE TABLE nope(x)', foreignKeysOff: true }])).toThrow(
      /desktop-99.*foreignKeysOff/
    )
    expect(tableNames(db)).not.toContain('nope')
    runSteps(db, [{ version: 99, sql: 'CREATE TABLE nope(x)', foreignKeysOff: true, server: 'CREATE TABLE yes(x)' }])
    expect(tableNames(db)).toContain('yes')
    db.close()
  })

  it('desktop-12 is skipped and server-2 numbers entries', () => {
    const db = freshDb()
    runSteps(db, [...MIGRATIONS.slice(0, 11), SERVER_STEPS[0]])
    db.exec(`
      INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd1', 'one', 'x', 'x');
      INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
        VALUES (1, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', 'desc', 'x');
      INSERT INTO card_printings (id, card_id, set_name, set_code, set_rarity) VALUES
        (7, 1, 'LOB', 'LOB-EN005', 'Ultra Rare'), (8, 1, 'SDY', 'SDY-006', 'Ultra Rare');
      INSERT INTO card_images (image_id, card_id, sort_order) VALUES (1, 1, 0);
      INSERT INTO collection_entries (id, user_id, uid, printing_id, image_id, quantity, created_at, updated_at) VALUES
        (4, 1, 'a', 7, 1, 1, 'x', 'x'), (6, 1, 'b', 8, 1, 2, 'x', 'x');
    `)
    migrateServer(db)
    const done = (db.prepare('SELECT name FROM server_migrations').all() as { name: string }[]).map((r) => r.name)
    expect(done).toEqual(expect.arrayContaining(['desktop-12', 'server-2']))
    expect(db.prepare('SELECT id, server_seq FROM collection_entries ORDER BY id').all()).toEqual([
      { id: 4, server_seq: 4 },
      { id: 6, server_seq: 6 }
    ])
    const cols = (db.prepare('PRAGMA table_info(collection_entries)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).not.toContain('owner_id')
    expect(cols).not.toContain('dirty')
    expect(tableNames(db)).toContain('desktop_codes')
    expect(tableNames(db)).not.toContain('sync_pending')
    expect(tableNames(db)).not.toContain('cloud_accounts')
    db.close()
  })

  it('upgraded and fresh servers end with the same schema', () => {
    const schema = (db: Database.Database): unknown[] =>
      db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
    const upgraded = freshDb()
    runSteps(upgraded, [...MIGRATIONS.slice(0, 11), SERVER_STEPS[0]])
    migrateServer(upgraded)
    const fresh = freshDb()
    migrateServer(fresh)
    expect(schema(upgraded)).toEqual(schema(fresh))
    upgraded.close()
    fresh.close()
  })

  it('late desktop steps touching collection data have a server override', () => {
    const late = MIGRATIONS.filter((m) => m.version >= 12 && /collection_entries|value_snapshots/.test(m.sql))
    expect(late.length).toBeGreaterThan(0)
    for (const m of late) expect(m.server, `desktop-${m.version}`).not.toBeUndefined()
  })
})
