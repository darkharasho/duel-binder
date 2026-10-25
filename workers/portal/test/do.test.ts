import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { doSql } from '../src/doSql'
import type { SqlDb } from '../../../src/main/db/sql'
import { searchCards } from '../../../src/main/repo/cards'

/** Run `fn` against a fresh, migrated Store's SQLite through the doSql adapter. */
function inStore<R>(name: string, fn: (db: SqlDb) => R): Promise<R> {
  const stub = env.STORE.get(env.STORE.idFromName(name))
  return runInDurableObject(stub, (_instance, state) => fn(doSql(state.storage)))
}

const insertCard = (db: SqlDb, id: number, name: string): void => {
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, ?, 'Normal Monster', 'normal', 'Dragon', '', '2026-10-24')`
  ).run(id, name)
}

describe('Store Durable Object SQLite', () => {
  it('all desktop + server migrations apply on DO SQLite', async () => {
    const names = await inStore('migrations', (db) =>
      (db.prepare('SELECT name FROM server_migrations').all() as { name: string }[]).map(
        (r) => r.name
      )
    )
    expect(names).toContain('desktop-10')
    expect(names).toContain('server-1')
  })

  it('FTS5 works', async () => {
    const hits = await inStore('fts', (db) => {
      insertCard(db, 89631139, 'Blue-Eyes White Dragon')
      db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
      return searchCards(db, 'blue')
    })
    expect(hits.map((h) => h.id)).toContain(89631139)
  })

  it('nested transaction rolls back as one unit', async () => {
    const ids = await inStore('nested', (db) => {
      const outer = db.transaction(() => {
        insertCard(db, 1, 'A')
        db.transaction(() => insertCard(db, 2, 'B'))()
        throw new Error('x')
      })
      expect(() => outer()).toThrow('x')
      return (db.prepare('SELECT id FROM cards WHERE id IN (1, 2)').all() as { id: number }[]).map(
        (r) => r.id
      )
    })
    expect(ids).toEqual([])
  })

  it('lastInsertRowid is the inserted id', async () => {
    const result = await inStore('rowid', (db) => {
      const info = db
        .prepare(
          "INSERT INTO users (discord_id, username, created_at, updated_at) VALUES (?, ?, 'now', 'now')"
        )
        .run('d-1', 'kaiba')
      const row = db.prepare('SELECT id FROM users WHERE discord_id = ?').get('d-1') as {
        id: number
      }
      return { lastInsertRowid: Number(info.lastInsertRowid), id: row.id, changes: info.changes }
    })
    expect(result.lastInsertRowid).toBe(result.id)
    expect(result.changes).toBe(1)
  })
})
