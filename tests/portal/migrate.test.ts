import Database from 'better-sqlite3'
import { migrateServer, runSteps } from '../../workers/portal/src/migrate'

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
})
