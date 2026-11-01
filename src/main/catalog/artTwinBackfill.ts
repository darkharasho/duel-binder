import type { SqlDb } from '../db/sql'
import { getMeta, setMeta } from '../db/meta'
import type { CatalogChangesResponse } from '../../shared/catalogFeed'
import { catalogCursorKey } from './apply'

/**
 * An app from before `art_twin_id` dropped the column from the rows it pulled, and its cursor is
 * past them, so the feed will never send those links again. Once, after that update, an app with a
 * Pokémon cursor reads `pokemon_cards` from the start and takes only the links. A database that has
 * never pulled Pokémon gets them with the rows, and so does anything changed from here on.
 */
export async function backfillArtTwins(
  db: SqlDb,
  page: (since: number) => Promise<CatalogChangesResponse>
): Promise<void> {
  if (getMeta(db, 'art_twins_backfilled') !== null) return
  if (getMeta(db, catalogCursorKey('pkm')) !== null) {
    const update = db.prepare('UPDATE pokemon_cards SET art_twin_id = ? WHERE card_id = ?')
    let cursor = 0
    for (;;) {
      const p = await page(cursor)
      if (p.more && p.cursor <= cursor) throw new Error('The catalog feed stopped advancing')
      db.transaction(() => {
        for (const c of p.changes) {
          if (c.table !== 'pokemon_cards' || !('row' in c) || c.row.art_twin_id == null) continue
          update.run(c.row.art_twin_id, c.row.card_id)
        }
      })()
      cursor = p.cursor
      if (!p.more) break
    }
  }
  setMeta(db, 'art_twins_backfilled', '1')
}
