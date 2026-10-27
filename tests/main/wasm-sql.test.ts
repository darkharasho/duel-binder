import { beforeAll, describe, expect, it } from 'vitest'
import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { openDatabase, MIGRATIONS } from '../../src/main/db/database'
import type { SqlDb } from '../../src/main/db/sql'
import { applyChanges, finishApply } from '../../src/main/catalog/apply'
import { addEntry } from '../../src/main/repo/collection'
import { searchCards } from '../../src/main/repo/cards'
import { cardsForImages, matchName, printingsByCode } from '../../src/main/repo/scan'
import type { CatalogChange, CatalogTableName } from '../../src/shared/catalogFeed'
import { openWasmDb } from '../../src/phone/data/wasmSql'
import { PHONE_FORMAT } from '../../src/phone/data/phoneSchema'
import { seededDb } from './helpers'

let sqlite3: Sqlite3Static
let changes: CatalogChange[]

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule()
  // Feed rows built from the fixture loaded through the real sync path, like catalog-apply.test.ts.
  const source = await seededDb()
  const tables: CatalogTableName[] = ['cards', 'card_images', 'card_printings', 'sets']
  let seq = 0
  changes = tables.flatMap((table) =>
    (
      source.prepare(`SELECT * FROM ${table}`).all() as Record<string, string | number | null>[]
    ).map((row) => ({
      seq: ++seq,
      table,
      row
    }))
  )
  source.close()
})

const open = (): SqlDb => openWasmDb(sqlite3, {})

function load(db: SqlDb): void {
  db.transaction(() => finishApply(db, applyChanges(db, changes)))()
}

describe('wasm SqlDb', () => {
  it('migrates to the latest desktop version', () => {
    const db = open()
    expect(db.prepare('PRAGMA user_version').get()).toEqual({
      user_version: MIGRATIONS.at(-1)!.version
    })
    expect(db.prepare("SELECT value FROM phone_state WHERE key = 'format'").get()).toEqual({
      value: String(PHONE_FORMAT)
    })
    expect(PHONE_FORMAT).toBe(1)
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  it('nested transactions roll back only the inner part', () => {
    const db = open()
    db.exec('CREATE TABLE t (x INTEGER)')
    const ins = db.prepare('INSERT INTO t (x) VALUES (?)')
    db.transaction(() => {
      ins.run(1)
      expect(() =>
        db.transaction(() => {
          ins.run(2)
          throw new Error('inner')
        })()
      ).toThrow('inner')
      ins.run(3)
    })()
    expect(db.prepare('SELECT x FROM t ORDER BY x').all()).toEqual([{ x: 1 }, { x: 3 }])

    expect(() =>
      db.transaction(() => {
        ins.run(4)
        throw new Error('outer')
      })()
    ).toThrow('outer')
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 2 })
  })

  it('run reports changes and lastInsertRowid', () => {
    const db = open()
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, x INTEGER)')
    expect(db.prepare('INSERT INTO t (x) VALUES (?)').run(5)).toEqual({
      changes: 1,
      lastInsertRowid: 1
    })
    expect(db.prepare('INSERT INTO t (id, x) VALUES (?, ?)').run(7, 5)).toEqual({
      changes: 1,
      lastInsertRowid: 7
    })
    expect(db.prepare('UPDATE t SET x = ? WHERE x = ?').run(6, 5).changes).toBe(2)
    expect(db.prepare('SELECT * FROM t WHERE id = ?').get(99)).toBeUndefined()
  })

  it('the scan queries run unchanged', () => {
    const wasm = open()
    const native = openDatabase(':memory:')
    load(wasm)
    load(native)
    const codes = (
      native
        .prepare('SELECT DISTINCT set_code AS c FROM card_printings ORDER BY c LIMIT 5')
        .all() as {
        c: string
      }[]
    ).map((r) => r.c)
    expect(codes.length).toBeGreaterThan(0)
    expect(printingsByCode(wasm, codes[0]).length).toBeGreaterThan(0)
    for (const code of [...codes, codes[0].toLowerCase(), 'NOPE-EN000']) {
      expect(printingsByCode(wasm, code), code).toEqual(printingsByCode(native, code))
    }
    for (const text of ['Dark Magician', 'POT OF GREED', 'harpies feather', 'zzzz']) {
      expect(matchName(wasm, text), text).toEqual(matchName(native, text))
    }
    expect(matchName(wasm, 'Dark Magician')?.name).toBe('Dark Magician')
    const ids = (
      native.prepare('SELECT image_id AS id FROM card_images').all() as { id: number }[]
    ).map((r) => r.id)
    expect(cardsForImages(wasm, [...ids, 123456789])).toEqual(
      cardsForImages(native, [...ids, 123456789])
    )
    expect(cardsForImages(wasm, ids)).toHaveLength(ids.length)
    native.close()
  })

  it('addEntry merges into the live entry', () => {
    const db = open()
    load(db)
    const p = db.prepare('SELECT id, card_id FROM card_printings ORDER BY id LIMIT 1').get() as {
      id: number
      card_id: number
    }
    const img = db
      .prepare('SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order LIMIT 1')
      .get(p.card_id) as { image_id: number }
    addEntry(db, { printingId: p.id, imageId: img.image_id, quantity: 1 })
    addEntry(db, { printingId: p.id, imageId: img.image_id, quantity: 1 })
    expect(db.prepare('SELECT quantity, dirty FROM collection_entries').all()).toEqual([
      { quantity: 2, dirty: 1 }
    ])
  })

  it('searchCards finds a fixture card through cards_fts', () => {
    const db = open()
    load(db)
    expect(searchCards(db, 'magic').map((r) => r.name)).toContain('Dark Magician')
  })
})
