import type { SqlDb } from '../../../src/main/db/sql'
import { getBinder, listBinders } from '../../../src/main/repo/binders'
import type { GameId } from '../../../src/shared/games'
import type { BinderDetail, BinderSummary } from '../../../src/shared/types'
import { userScope } from './scope'

/** The uids of the owner's binders that friends may see; one small read, before any slot work. */
function visibleUids(db: SqlDb, friend: number, game: GameId): Set<string> {
  const scope = userScope(friend, game)
  const rows = db
    .prepare(`SELECT b.uid FROM binders b WHERE ${scope.where('b')} AND b.friends_visible = 1`)
    .all() as { uid: string }[]
  return new Set(rows.map((r) => r.uid))
}

/**
 * A friend's binders they chose to show, with progress against that friend's own collection.
 * Private ones are left out entirely, so neither they nor their number can be told from outside.
 */
export function friendBinders(db: SqlDb, friend: number, game: GameId): BinderSummary[] {
  const visible = visibleUids(db, friend, game)
  if (visible.size === 0) return []
  return listBinders(db, userScope(friend, game), visible)
}

/** One visible binder of a friend's; null for a private, deleted, unknown or other-game uid alike. */
export function friendBinder(
  db: SqlDb,
  friend: number,
  game: GameId,
  uid: string
): BinderDetail | null {
  if (!visibleUids(db, friend, game).has(uid)) return null
  return getBinder(db, uid, userScope(friend, game))
}
