import type { SqlDb } from '../db/sql'
import { CollectionError } from './collection'
import { LOCAL, type Scope } from './scope'

/** The ids of the scope's favourite cards of its game, smallest first. */
export function listFavourites(db: SqlDb, scope: Scope = LOCAL): number[] {
  const rows = db
    .prepare(`SELECT f.card_id FROM favourites f WHERE ${scope.where('f')} ORDER BY f.card_id`)
    .all() as { card_id: number }[]
  return rows.map((r) => r.card_id)
}

/**
 * Hearts a card (`on`) or takes the heart off it. Unhearting leaves a tombstone, so other devices
 * hear of it; doing what's already done writes nothing.
 */
export function setFavourite(
  db: SqlDb,
  cardId: number,
  on: unknown,
  now = new Date(),
  scope: Scope = LOCAL
): void {
  if (typeof on !== 'boolean') throw new CollectionError('on must be true or false')
  const card = db
    .prepare(`SELECT 1 FROM cards c WHERE c.id = ? AND +c.game = ${scope.game}`)
    .get(cardId)
  if (!card) throw new CollectionError(`Card ${cardId} not found`)
  const { ownerCol, owner, markerCol, marker, touch } = scope.favourites
  const live = db
    .prepare(`SELECT 1 FROM favourites f WHERE f.card_id = ? AND ${scope.where('f')}`)
    .get(cardId)
  if (Boolean(live) === on) return
  const ts = now.toISOString()
  if (on) {
    db.prepare(
      `INSERT INTO favourites (${ownerCol}, card_id, game, created_at, updated_at, ${markerCol})
       VALUES (${owner}, ?, ${scope.game}, ?, ?, ${marker})
       ON CONFLICT(${ownerCol}, card_id) DO UPDATE SET game = excluded.game,
         created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = NULL, ${touch}`
    ).run(cardId, ts, ts)
  } else {
    db.prepare(
      `UPDATE favourites AS f SET deleted_at = ?, updated_at = ?, ${touch}
       WHERE f.card_id = ? AND ${scope.where('f')}`
    ).run(ts, ts, cardId)
  }
}
