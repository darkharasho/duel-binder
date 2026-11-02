import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'
import { getMeta, setMeta } from '../../src/main/db/meta'
import { backfillSetSeries } from '../../src/main/catalog/seriesBackfill'
import type { CatalogChangesResponse } from '../../src/shared/catalogFeed'
import { seedPokemon } from '../fixtures/pokemon'

const page = (
  rows: Record<string, string | null>[],
  cursor: number,
  more: boolean
): CatalogChangesResponse => ({
  changes: rows.map((row, i) => ({ seq: i + 1, table: 'sets', row: { game: 'pkm', ...row } })),
  cursor,
  more,
  dbVersion: null,
  latest: cursor
})

function fresh(): Database.Database {
  const db = new Database(':memory:')
  migrate(db)
  seedPokemon(db)
  return db
}

const seriesOf = (db: Database.Database): unknown[] =>
  db.prepare("SELECT language, series FROM sets WHERE game = 'pkm' ORDER BY language").all()

describe('backfillSetSeries', () => {
  it('reads every page once, takes only the series, and never runs again', async () => {
    const db = fresh()
    setMeta(db, 'catalog_cursor:pkm', '500')
    const [en, ja] = db
      .prepare("SELECT language, set_name FROM sets WHERE game = 'pkm' ORDER BY language")
      .all() as { language: string; set_name: string }[]
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([{ ...en, series: 'Scarlet & Violet', set_code: 'X' }], 7, true))
      .mockResolvedValueOnce(page([{ ...ja, series: null }], 9, false))
    await backfillSetSeries(db, fetchPage)
    await backfillSetSeries(db, fetchPage)
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 7])
    expect(seriesOf(db)).toEqual([
      { language: 'en', series: 'Scarlet & Violet' },
      { language: 'ja', series: null }
    ])
    expect(db.prepare("SELECT set_code FROM sets WHERE language = 'en'").pluck().get()).not.toBe(
      'X'
    )
    expect(getMeta(db, 'catalog_cursor:pkm')).toBe('500')
    db.close()
  })

  it('a database that never pulled Pokémon needs nothing', async () => {
    const db = fresh()
    const fetchPage = vi.fn()
    await backfillSetSeries(db, fetchPage)
    expect(fetchPage).not.toHaveBeenCalled()
    expect(getMeta(db, 'set_series_backfilled')).toBe('1')
    db.close()
  })

  it('a failed page tries again next time', async () => {
    const db = fresh()
    setMeta(db, 'catalog_cursor:pkm', '500')
    await expect(backfillSetSeries(db, () => Promise.reject(new Error('down')))).rejects.toThrow(
      'down'
    )
    expect(getMeta(db, 'set_series_backfilled')).toBeNull()
    db.close()
  })
})
