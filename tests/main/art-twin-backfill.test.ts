import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'
import { getMeta, setMeta } from '../../src/main/db/meta'
import { backfillArtTwins } from '../../src/main/catalog/artTwinBackfill'
import { applyChanges } from '../../src/main/catalog/apply'
import type { CatalogChangesResponse } from '../../src/shared/catalogFeed'
import { seedPokemon } from '../fixtures/pokemon'

const page = (rows: Record<string, number | null>[], cursor: number, more: boolean): CatalogChangesResponse => ({
  changes: rows.map((row, i) => ({ seq: i + 1, table: 'pokemon_cards', row })),
  cursor,
  more,
  dbVersion: null,
  latest: cursor
})

function fresh(): { db: Database.Database; ids: number[] } {
  const db = new Database(':memory:')
  migrate(db)
  return { db, ids: seedPokemon(db).cardIds }
}

const twinOf = (db: Database.Database, id: number): unknown =>
  db.prepare('SELECT art_twin_id AS t FROM pokemon_cards WHERE card_id = ?').pluck().get(id)

describe('backfillArtTwins', () => {
  it('reads every page once, takes only the links, and never runs again', async () => {
    const { db, ids } = fresh()
    setMeta(db, 'catalog_cursor:pkm', '500')
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([{ card_id: ids[0], art_twin_id: ids[1] }], 7, true))
      .mockResolvedValueOnce(page([{ card_id: ids[1], art_twin_id: null }], 9, false))
    await backfillArtTwins(db, fetchPage)
    await backfillArtTwins(db, fetchPage)
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 7])
    expect(twinOf(db, ids[0])).toBe(ids[1])
    expect(twinOf(db, ids[1])).toBeNull()
    expect(getMeta(db, 'catalog_cursor:pkm')).toBe('500')
    db.close()
  })

  it('a database that never pulled Pokémon needs nothing', async () => {
    const { db } = fresh()
    const fetchPage = vi.fn()
    await backfillArtTwins(db, fetchPage)
    expect(fetchPage).not.toHaveBeenCalled()
    expect(getMeta(db, 'art_twins_backfilled')).toBe('1')
    db.close()
  })

  it('a failed page tries again next time', async () => {
    const { db, ids } = fresh()
    setMeta(db, 'catalog_cursor:pkm', '500')
    await expect(backfillArtTwins(db, () => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(getMeta(db, 'art_twins_backfilled')).toBeNull()
    await backfillArtTwins(db, async () => page([{ card_id: ids[0], art_twin_id: ids[1] }], 1, false))
    expect(twinOf(db, ids[0])).toBe(ids[1])
    db.close()
  })
})

describe('a client without the column', () => {
  it('applies a feed row carrying art_twin_id, dropping the column', () => {
    const { db, ids } = fresh()
    db.exec('DROP INDEX ix_pokemon_cards_art_twin; ALTER TABLE pokemon_cards DROP COLUMN art_twin_id')
    db.transaction(() =>
      applyChanges(db, [
        {
          seq: 1,
          table: 'pokemon_cards',
          row: { card_id: ids[0], category: 'Pokemon', source_id: 'zh-hans/X-1', art_twin_id: ids[1] }
        }
      ])
    )()
    expect(db.prepare('SELECT source_id FROM pokemon_cards WHERE card_id = ?').pluck().get(ids[0])).toBe(
      'zh-hans/X-1'
    )
    db.close()
  })
})
