import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'
import { LOCAL } from '../../src/main/repo/scope'
import { databaseAt } from './helpers'

const tables = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)

describe('migration V30/V31 (binders)', () => {
  it('migrates a version 29 database to 31 and keeps wishlist rows', () => {
    const db = databaseAt(29)
    db.prepare(
      `INSERT INTO wishlist_entries (owner_id, pkey, game, quantity, created_at, updated_at) VALUES (0, 'k', 'ygo', 2, 't', 't')`
    ).run()
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(31)
    expect(tables(db)).toEqual(expect.arrayContaining(['binders', 'binder_edits']))
    expect(db.prepare('SELECT pkey, quantity FROM wishlist_entries').all()).toEqual([{ pkey: 'k', quantity: 2 }])
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ix_pokemon_cards_illustrator'").all()
    expect(idx).toHaveLength(1)
    db.close()
  })

  it('binderSync is dirty-based locally', () => {
    expect(LOCAL.binderSync('binders').touch).toBe('dirty = 1')
    expect(LOCAL.binderSync('binder_edits').markerCol).toBe('dirty')
  })
})
