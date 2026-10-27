import Database from 'better-sqlite3'
import { MIGRATIONS } from '../../src/main/db/schema'
import { catalogChanges } from '../../workers/portal/src/catalogFeed'
import { runSteps, SERVER_STEPS } from '../../workers/portal/src/migrate'
import { seededServerDb } from './helpers'

const TABLES = [
  'cards', 'card_images', 'card_printings', 'sets', 'pack_art', 'set_logos', 'konami_logos',
  'tcgplayer_groups', 'tcgplayer_products'
]

const clock = (db: Database.Database): number =>
  (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq

function allSeqs(db: Database.Database): number[] {
  return TABLES.flatMap((t) =>
    (db.prepare(`SELECT catalog_seq AS s FROM ${t}`).all() as { s: number }[]).map((r) => r.s)
  )
}

function addSet(db: Database.Database, name: string): void {
  db.prepare("INSERT INTO sets (language, set_name, set_code) VALUES ('en', ?, 'TST')").run(name)
}

describe('catalog change feed (server-6)', () => {
  it('gives every seeded catalog row a distinct seq and moves the clock to the max', async () => {
    const db = await seededServerDb()
    const seqs = allSeqs(db)
    expect(seqs.length).toBeGreaterThan(0)
    expect(seqs.every((s) => s > 0)).toBe(true)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(clock(db)).toBe(Math.max(...seqs))
    db.close()
  })

  it('stamps a new seq when a row really changes', async () => {
    const db = await seededServerDb()
    const before = clock(db)
    const { id } = db.prepare('SELECT id FROM cards LIMIT 1').get() as { id: number }
    db.prepare("UPDATE cards SET name = 'X' WHERE id = ?").run(id)
    const after = (db.prepare('SELECT catalog_seq AS s FROM cards WHERE id = ?').get(id) as { s: number }).s
    expect(after).toBeGreaterThan(before)
    expect(clock(db)).toBe(after)
    db.close()
  })

  it('keeps the seq when an update changes nothing', async () => {
    const db = await seededServerDb()
    const before = clock(db)
    const { id, catalog_seq } = db.prepare('SELECT id, catalog_seq FROM cards LIMIT 1').get() as {
      id: number
      catalog_seq: number
    }
    db.prepare('UPDATE cards SET name = name WHERE id = ?').run(id)
    expect((db.prepare('SELECT catalog_seq AS s FROM cards WHERE id = ?').get(id) as { s: number }).s).toBe(catalog_seq)
    expect(clock(db)).toBe(before)
    db.close()
  })

  it('stamps a printing when contributed changes', async () => {
    const db = await seededServerDb()
    const before = clock(db)
    const { id } = db.prepare('SELECT id FROM card_printings LIMIT 1').get() as { id: number }
    db.prepare('UPDATE card_printings SET contributed = 1 WHERE id = ?').run(id)
    expect(clock(db)).toBe(before + 1)
    db.close()
  })

  it('writes a tombstone on delete', async () => {
    const db = await seededServerDb()
    addSet(db, 'Gone Set')
    db.prepare("DELETE FROM sets WHERE set_name = 'Gone Set'").run()
    const t = db.prepare("SELECT * FROM catalog_tombstones WHERE tbl = 'sets'").get() as {
      seq: number
      tbl: string
      key: string
    }
    expect(t.key).toBe('["en","Gone Set"]')
    expect(t.seq).toBe(clock(db))

    const p = db.prepare('SELECT id, pkey FROM card_printings LIMIT 1').get() as { id: number; pkey: string }
    db.prepare('DELETE FROM card_printings WHERE id = ?').run(p.id)
    const tp = db.prepare("SELECT key, seq FROM catalog_tombstones WHERE tbl = 'card_printings'").get() as {
      key: string
      seq: number
    }
    expect(tp.key).toBe(JSON.stringify([p.pkey]))
    expect(tp.seq).toBe(clock(db))
    db.close()
  })

  it('backfills rows that existed before server-6', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runSteps(db, [...MIGRATIONS])
    const ins = db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'C', 'Normal Monster', 'normal', 'Warrior', 'd', '2026-10-23')`
    )
    for (const id of [5, 9, 12]) ins.run(id)
    addSet(db, 'S1')
    runSteps(db, SERVER_STEPS)
    const seqs = allSeqs(db)
    expect(seqs.sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(clock(db)).toBe(4)
    db.close()
  })

  it('tombstones the old key when a key changes in place, before the row under its new key', async () => {
    const db = await seededServerDb()
    addSet(db, 'Old Name')
    const p = db.prepare("SELECT id, pkey FROM card_printings WHERE language = 'en' LIMIT 1").get() as {
      id: number
      pkey: string
    }
    const since = clock(db)

    db.prepare("UPDATE sets SET set_name = 'New Name' WHERE set_name = 'Old Name'").run()
    db.prepare("UPDATE card_printings SET set_code = set_code || '-X' WHERE id = ?").run(p.id)
    const newPkey = (db.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(p.id) as { pkey: string }).pkey

    const { changes } = catalogChanges(db, since, 100)
    const brief = changes.map((c) =>
      'deleted' in c ? ['deleted', c.table, c.deleted] : ['row', c.table, c.table === 'sets' ? c.row.set_name : c.row.pkey]
    )
    expect(brief).toEqual([
      ['deleted', 'sets', ['en', 'Old Name']],
      ['row', 'sets', 'New Name'],
      ['deleted', 'card_printings', [p.pkey]],
      ['row', 'card_printings', newPkey]
    ])
    db.close()
  })

  it('writes no tombstone when a non-key column changes', async () => {
    const db = await seededServerDb()
    const { id } = db.prepare('SELECT id FROM card_printings LIMIT 1').get() as { id: number }
    db.prepare('UPDATE card_printings SET set_price = 4.56 WHERE id = ?').run(id)
    expect(db.prepare('SELECT count(*) AS n FROM catalog_tombstones').get()).toEqual({ n: 0 })
    db.close()
  })

  it('a backfill cut short keeps the finished tables and the next run finishes the rest', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runSteps(db, [...MIGRATIONS])
    const ins = db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'C', 'Normal Monster', 'normal', 'Warrior', 'd', '2026-10-23')`
    )
    for (const id of [5, 9, 12]) ins.run(id)
    addSet(db, 'S1')
    const cardsDone = SERVER_STEPS.findIndex((s) => s.name === 'server-6-backfill-cards') + 1
    // A startup that stops right after the cards backfill (e.g. out of time on the next table).
    expect(() =>
      runSteps(db, [...SERVER_STEPS.slice(0, cardsDone), { name: 'out-of-time', sql: 'SELECT no_such_fn()' }])
    ).toThrow()
    expect(clock(db)).toBe(3)

    runSteps(db, SERVER_STEPS)
    expect(allSeqs(db).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(clock(db)).toBe(4)
    // The triggers exist once it's done.
    addSet(db, 'S2')
    expect(clock(db)).toBe(5)
    db.close()
  })
})
