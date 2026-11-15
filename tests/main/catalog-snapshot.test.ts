import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { runApplyJob, withoutForeignKeys } from '../../src/main/catalog/applyJob'
import { exportSnapshot, snapshotTables } from '../../src/main/catalog/snapshot'
import { getMeta } from '../../src/main/db/meta'
import { catalogShape } from '../../src/shared/catalogSnapshot'
import { seedMagic } from '../fixtures/magic'
import { seededDb } from './helpers'

const count = (db: Database.Database, table: string, where = ''): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table} ${where}`).get() as { n: number }).n

const MTG_TABLES = ['cards', 'card_images', 'card_printings', 'sets', 'mtg_cards', 'mtg_images']
const mtgCount = (db: Database.Database, table: string): number =>
  ['cards', 'card_images', 'card_printings', 'sets'].includes(table)
    ? count(db, table, "WHERE game = 'mtg'")
    : count(db, table)

/** A source database with the Magic fixture plus a few more cards, exported to a file. */
async function built(): Promise<{ file: string; source: Database.Database }> {
  const source = await seededDb()
  seedMagic(source)
  const card = source.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, 'mtg', ?, 'Creature', 'mtg', '', '', '2026-11-09')`
  )
  const printing = source.prepare(
    `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, remote_id)
     VALUES ('mtg', ?, 'en', 'Magic 2015', ?, 'Common', ?)`
  )
  for (let i = 1; i <= 4; i++) {
    const id = 9_100_000_000 + i
    card.run(id, `Snapshot Beast ${i}`)
    printing.run(id, `M15 ${100 + i}`, 7000 + i)
  }
  const file = join(mkdtempSync(join(tmpdir(), 'snap-')), 'mtg.sqlite')
  exportSnapshot(source, 'mtg', file, { cursor: 4321, dbVersion: 'v7' })
  return { file, source }
}

const job = (file: string) =>
  ({ kind: 'snapshot', game: 'mtg', file, cursor: 4321, dbVersion: 'v7' }) as const

describe('exportSnapshot', () => {
  it('lists the game tables parent first', () => {
    expect(snapshotTables('mtg').map((t) => t.name)).toEqual(MTG_TABLES)
  })

  it("exports only the game's tables with snapshot_meta", async () => {
    const { file, source } = await built()
    const snap = new Database(file, { readonly: true })
    const meta = snap.prepare('SELECT * FROM snapshot_meta').get() as Record<string, unknown>
    expect(meta).toMatchObject({
      game: 'mtg',
      cursor: 4321,
      db_version: 'v7',
      shape: catalogShape()
    })
    const tables = (
      snap.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string
      }[]
    ).map((r) => r.name)
    expect(tables.sort()).toEqual([...MTG_TABLES, 'snapshot_meta'].sort())
    const cols = (
      snap.prepare("SELECT name FROM pragma_table_info('card_printings')").all() as {
        name: string
      }[]
    ).map((c) => c.name)
    expect(cols).not.toContain('id')
    expect(cols).not.toContain('pkey')
    expect(cols).toContain('remote_id')
    const counts = JSON.parse(meta.counts as string) as Record<string, number>
    for (const t of MTG_TABLES) {
      expect(count(snap, t), t).toBe(mtgCount(source, t))
      expect(counts[t], t).toBe(mtgCount(source, t))
    }
    expect(count(snap, 'cards', "WHERE game <> 'mtg'")).toBe(0)
  })
})

describe("runApplyJob 'snapshot'", () => {
  it('imports every row and sets the cursor last', async () => {
    const { file, source } = await built()
    const db = await seededDb()
    const ygoCards = count(db, 'cards', "WHERE game = 'ygo'")

    withoutForeignKeys(db, () => runApplyJob(db, job(file), { chunk: 2 }))

    for (const t of MTG_TABLES) expect(mtgCount(db, t), t).toBe(mtgCount(source, t))
    expect(count(db, 'cards', "WHERE game = 'ygo'")).toBe(ygoCards)
    expect(getMeta(db, 'catalog_cursor:mtg')).toBe('4321')
    expect(getMeta(db, 'db_version')).toBe('v7')
    expect(getMeta(db, 'catalog_snapshot:mtg')).toBeNull()
    expect(
      db.prepare("SELECT remote_id FROM card_printings WHERE set_code = 'M15 102'").get()
    ).toEqual({ remote_id: 7002 })
    expect(db.pragma('foreign_key_check')).toEqual([])

    runApplyJob(db, { kind: 'finish' })
    expect(
      db.prepare("SELECT count(*) AS n FROM cards_fts WHERE cards_fts MATCH 'snapshot beast'").get()
    ).toEqual({ n: 4 })
  })

  it('resumes an import stopped partway', async () => {
    const { file, source } = await built()
    const db = await seededDb()
    let pauses = 0
    const stopAfterTwo = (): void => {
      if (++pauses === 2) throw new Error('quit')
    }

    expect(() =>
      withoutForeignKeys(db, () => runApplyJob(db, job(file), { chunk: 2, pause: stopAfterTwo }))
    ).toThrow('quit')
    expect(getMeta(db, 'catalog_cursor:mtg')).toBeNull()
    expect(getMeta(db, 'catalog_snapshot:mtg')).not.toBeNull()
    expect(mtgCount(db, 'cards')).toBeGreaterThan(0)

    withoutForeignKeys(db, () => runApplyJob(db, job(file), { chunk: 2 }))
    for (const t of MTG_TABLES) expect(mtgCount(db, t), t).toBe(mtgCount(source, t))
    expect(getMeta(db, 'catalog_cursor:mtg')).toBe('4321')
    expect(getMeta(db, 'catalog_snapshot:mtg')).toBeNull()
  })

  it('refuses a snapshot of another shape', async () => {
    const { file } = await built()
    const w = new Database(file)
    w.prepare("UPDATE snapshot_meta SET shape = 'ffffffff'").run()
    w.close()
    const db = await seededDb()

    expect(() => withoutForeignKeys(db, () => runApplyJob(db, job(file)))).toThrow('catalog shape')
    expect(getMeta(db, 'catalog_cursor:mtg')).toBeNull()
    expect(mtgCount(db, 'cards')).toBe(0)
    // Detached again: a later attach under the same name works.
    expect(
      (db.prepare('PRAGMA database_list').all() as { name: string }[]).map((d) => d.name)
    ).not.toContain('snap')
  })

  it('refuses to import with foreign keys on', async () => {
    const { file } = await built()
    const db = await seededDb()
    expect(() => runApplyJob(db, job(file))).toThrow('foreign keys off')
  })
})
