import type { SqlDb } from '../db/sql'
import { getMeta, setMeta } from '../db/meta'
import type { CatalogChangesResponse } from '../../shared/catalogFeed'
import { catalogCursorKey } from './apply'

/**
 * An app from before `sets.series` dropped it from the set rows it pulled, and its cursor may be
 * past the night that filled it in, so the feed won't send those rows again. Once, after that
 * update, an app with a Pokémon cursor reads `sets` from the start (a few thousand rows) and takes
 * only the series. As with backfillArtTwins, a database that never pulled Pokémon gets them with
 * the rows.
 */
export async function backfillSetSeries(
  db: SqlDb,
  page: (since: number) => Promise<CatalogChangesResponse>
): Promise<void> {
  if (getMeta(db, 'set_series_backfilled') !== null) return
  if (getMeta(db, catalogCursorKey('pkm')) !== null) {
    const update = db.prepare(
      "UPDATE sets SET series = ? WHERE game = 'pkm' AND language = ? AND set_name = ?"
    )
    let cursor = 0
    for (;;) {
      const p = await page(cursor)
      if (p.more && p.cursor <= cursor) throw new Error('The catalog feed stopped advancing')
      db.transaction(() => {
        for (const c of p.changes) {
          if (c.table !== 'sets' || !('row' in c)) continue
          const { series, language, set_name } = c.row
          if (series != null) update.run(series, language, set_name)
        }
      })()
      cursor = p.cursor
      if (!p.more) break
    }
  }
  setMeta(db, 'set_series_backfilled', '1')
}
