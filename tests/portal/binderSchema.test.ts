import Database from 'better-sqlite3'
import { migrateServer } from '../../workers/portal/src/migrate'
import { userScope } from '../../workers/portal/src/scope'

function setup(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateServer(db)
  db.prepare(`INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd', 'u', '', '')`).run()
  return db
}

const addBinder = (db: Database.Database, uid: string): void => {
  db.prepare(
    `INSERT INTO binders (user_id, uid, game, name, rules, goal, languages, created_at, updated_at, seq)
     VALUES (1, ?, 'ygo', 'n', '{}', '{}', '[]', 't', 't', ${userScope(1, 'ygo').binderSync('binders').marker})`
  ).run(uid)
}

describe('binder tables', () => {
  it('exist, with the new indexes', () => {
    const db = setup()
    const names = (db.prepare("SELECT name FROM sqlite_master").all() as { name: string }[]).map((r) => r.name)
    expect(names).toEqual(
      expect.arrayContaining(['binders', 'binder_edits', 'ix_printings_card', 'ix_pokemon_cards_illustrator'])
    )
    db.close()
  })

  it('are removed with their user', () => {
    const db = setup()
    addBinder(db, 'a')
    db.prepare(
      `INSERT INTO binder_edits (user_id, binder_uid, level, target, game, action, created_at, updated_at, seq)
       VALUES (1, 'a', 'card', '1', 'ygo', 'add', 't', 't', ${userScope(1, 'ygo').binderSync('binder_edits').marker})`
    ).run()
    db.prepare('DELETE FROM users WHERE id = 1').run()
    expect(db.prepare('SELECT count(*) AS n FROM binders').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM binder_edits').get()).toEqual({ n: 0 })
    db.close()
  })

  it('binderSync touch gives a new seq on each statement', () => {
    const db = setup()
    addBinder(db, 'a')
    const { touch } = userScope(1, 'ygo').binderSync('binders')
    const seq = (): number => (db.prepare('SELECT seq FROM binders').get() as { seq: number }).seq
    const first = seq()
    db.prepare(`UPDATE binders SET name = 'x', ${touch}`).run()
    const second = seq()
    db.prepare(`UPDATE binders SET name = 'y', ${touch}`).run()
    expect(second).toBe(first + 1)
    expect(seq()).toBe(second + 1)
    db.close()
  })
})
