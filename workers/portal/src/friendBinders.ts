import type { SqlDb } from '../../../src/main/db/sql'
import { getBinder, listBinders } from '../../../src/main/repo/binders'
import type { GameId } from '../../../src/shared/games'
import type { BinderDetail, BinderSummary } from '../../../src/shared/types'
import { userScope } from './scope'

/**
 * A friend's binders they chose to show, with progress against that friend's own collection.
 * Private ones are left out entirely, so neither they nor their number can be told from outside.
 */
export function friendBinders(db: SqlDb, friend: number, game: GameId): BinderSummary[] {
  return listBinders(db, userScope(friend, game)).filter((b) => b.friendsVisible)
}

/** One visible binder of a friend's; null for a private, deleted, unknown or other-game uid alike. */
export function friendBinder(
  db: SqlDb,
  friend: number,
  game: GameId,
  uid: string
): BinderDetail | null {
  const detail = getBinder(db, uid, userScope(friend, game))
  return detail?.friendsVisible ? detail : null
}
