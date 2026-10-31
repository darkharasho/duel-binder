import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { applyDexImport, previewDexImport } from '../../src/main/repo/dexImport'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { localScope } from '../../src/main/repo/scope'
import { pokemonId } from '../../src/shared/games'
import type { DexRow } from '../../src/shared/dex/parse'

const SOURCE = 'en/sv08.5-001'
const CARD = pokemonId(SOURCE)
const PKM = localScope("'pkm'")

function seed(db: Database.Database): { normal: number; reverse: number; dropped: number } {
  db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, 'pkm', 'Exeggcute', 'Pokémon', 'pokemon', 'Basic', '', '2026-10-30')`
  ).run(CARD)
  db.prepare(
    "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'pkm', ?, 0)"
  ).run(CARD, CARD)
  db.prepare(
    `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id)
     VALUES (?, 'Pokémon', 60, '[]', 'Basic', 'Common', 'Iori Suzuki', ?)`
  ).run(CARD, SOURCE)
  const printing = (version: string, missing = 0): number =>
    Number(
      db
        .prepare(
          `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, missing_from_api)
           VALUES ('pkm', ?, 'en', 'Prismatic Evolutions', 'PRE 001/131', ?, ?)`
        )
        .run(CARD, version, missing).lastInsertRowid
    )
  return {
    normal: printing('Normal'),
    reverse: printing('Reverse Holofoil'),
    dropped: printing('Holofoil', 1)
  }
}

const row = (variant: string, quantity: number): DexRow => ({
  locale: 'International',
  series: 'Scarlet & Violet',
  set: 'Prismatic Evolutions',
  id: 'sv85-1',
  number: '1/131',
  name: 'Exeggcute',
  variant,
  quantity
})

const held = (db: Database.Database, printingId: number): number =>
  (
    db
      .prepare(
        'SELECT COALESCE(SUM(quantity), 0) AS n FROM collection_entries WHERE printing_id = ? AND deleted_at IS NULL'
      )
      .get(printingId) as { n: number }
  ).n

describe('Dex import', () => {
  let db: Database.Database
  let ids: ReturnType<typeof seed>
  beforeEach(async () => {
    db = await seededDb()
    ids = seed(db)
  })

  it('previews without writing, then adds marked for sync', () => {
    const rows = [row('Normal', 3), row('Reverse Holo', 2), row('Normal', 0)]
    expect(previewDexImport(db, rows)).toEqual({
      copies: 5,
      printings: 2,
      alreadyOwned: 0,
      zeroRows: 1,
      repeatRows: 0,
      notImported: []
    })
    expect(held(db, ids.normal)).toBe(0)

    expect(applyDexImport(db, rows)).toEqual({ copies: 5 })
    expect(held(db, ids.normal)).toBe(3)
    expect(held(db, ids.reverse)).toBe(2)
    const stored = db.prepare('SELECT game, dirty FROM collection_entries').all()
    expect(stored).toEqual([
      { game: 'pkm', dirty: 1 },
      { game: 'pkm', dirty: 1 }
    ])
  })

  it('importing the same file again adds nothing', () => {
    const rows = [row('Normal', 3)]
    applyDexImport(db, rows)
    expect(previewDexImport(db, rows)).toMatchObject({ copies: 0, printings: 0, alreadyOwned: 1 })
    expect(applyDexImport(db, rows)).toEqual({ copies: 0 })
    expect(held(db, ids.normal)).toBe(3)
  })

  it('adds only the difference and never lowers a count', () => {
    addEntry(db, { printingId: ids.normal, imageId: CARD, quantity: 2 }, new Date(), PKM)
    addEntry(db, { printingId: ids.reverse, imageId: CARD, quantity: 9 }, new Date(), PKM)
    expect(applyDexImport(db, [row('Normal', 5), row('Reverse Holo', 4)])).toEqual({ copies: 3 })
    expect(held(db, ids.normal)).toBe(5)
    expect(held(db, ids.reverse)).toBe(9)
    expect(db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()).toEqual({ n: 2 })
  })

  it('does not count a deleted entry', () => {
    const e = addEntry(db, { printingId: ids.normal, imageId: CARD, quantity: 2 }, new Date(), PKM)
    PKM.deleteEntry(db, e.id, new Date().toISOString())
    expect(previewDexImport(db, [row('Normal', 2)])).toMatchObject({ copies: 2 })
  })

  it('does not land on a version the catalog dropped', () => {
    const preview = previewDexImport(db, [row('Holo', 1)])
    expect(preview.copies).toBe(0)
    expect(preview.notImported.map((m) => m.reason)).toEqual(['finish'])
  })

  it('imports into Pokémon with Yu-Gi-Oh! showing, and leaves its list alone', () => {
    applyDexImport(db, [row('Normal', 1)])
    expect(listEntries(db, { sort: 'name', dir: 'asc' })).toEqual([])
  })
})
