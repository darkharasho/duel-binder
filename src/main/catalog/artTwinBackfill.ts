import type { SqlDb } from '../db/sql'
import { getMeta, setMeta } from '../db/meta'
import type { CatalogChangesResponse } from '../../shared/catalogFeed'
import { catalogCursorKey } from './apply'

/** Each link column, and the meta key set once this database has that column's links. */
const LINKS = [
  { column: 'art_twin_id', done: 'art_twins_backfilled' },
  { column: 'traditional_twin_id', done: 'traditional_twins_backfilled' }
] as const

/**
 * An app from before a link column dropped it from the rows it pulled, and its cursor is past them,
 * so the feed will never send those links again. Once, after that update, an app with a Pokémon
 * cursor reads `pokemon_cards` from the start and takes only the links it lacks. A database that
 * has never pulled Pokémon gets them with the rows, and so does anything changed from here on.
 */
export async function backfillArtTwins(
  db: SqlDb,
  page: (since: number) => Promise<CatalogChangesResponse>
): Promise<void> {
  const links = LINKS.filter((l) => getMeta(db, l.done) === null)
  if (links.length === 0) return
  if (getMeta(db, catalogCursorKey('pkm')) !== null) {
    const updates = links.map(({ column }) => ({
      column,
      update: db.prepare(`UPDATE pokemon_cards SET ${column} = ? WHERE card_id = ?`)
    }))
    let cursor = 0
    for (;;) {
      const p = await page(cursor)
      if (p.more && p.cursor <= cursor) throw new Error('The catalog feed stopped advancing')
      db.transaction(() => {
        for (const c of p.changes) {
          if (c.table !== 'pokemon_cards' || !('row' in c)) continue
          for (const { column, update } of updates) {
            const value = c.row[column]
            if (value != null) update.run(value, c.row.card_id)
          }
        }
      })()
      cursor = p.cursor
      if (!p.more) break
    }
  }
  for (const { done } of links) setMeta(db, done, '1')
}
