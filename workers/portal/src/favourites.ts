import type { SqlDb } from '../../../src/main/db/sql'
import { checkObject } from '../../../src/main/repo/args'
import { CollectionError } from '../../../src/main/repo/collection'
import {
  MAX_PULL,
  replaces,
  type FavouritePullResponse,
  type FavouritePushResult,
  type WireFavourite
} from '../../../src/shared/cloud'
import { isGameId, type GameId } from '../../../src/shared/games'
import { NEXT_FAVOURITE_SEQ } from './scope'
import { checkTime, pageCursor } from './sync'

/** Validates a favourites push body; throws CollectionError (a 400) on anything malformed. */
export function checkFavouritePush(body: unknown, now: Date): WireFavourite[] {
  const entries = (body as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new CollectionError('entries must be an array')
  return entries.map((v): WireFavourite => {
    const o = checkObject(v, 'Entry')
    if (typeof o.cardId !== 'number' || !Number.isSafeInteger(o.cardId) || o.cardId < 1)
      throw new CollectionError('cardId must be a positive whole number')
    if (!isGameId(o.game)) throw new CollectionError('game must be a game')
    return {
      cardId: o.cardId,
      game: o.game,
      createdAt: checkTime(o.createdAt, 'createdAt', now),
      updatedAt: checkTime(o.updatedAt, 'updatedAt', now),
      deletedAt: o.deletedAt === null ? null : checkTime(o.deletedAt, 'deletedAt', now)
    }
  })
}

interface FavouriteRow {
  card_id: number
  game: GameId
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

const toWire = (r: FavouriteRow): WireFavourite => ({
  cardId: r.card_id,
  game: r.game,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/**
 * Applies pushed favourites for `userId`, latest edit wins per card. A row of a game outside
 * `games` is skipped, so the client keeps it and retries. The card isn't checked against the
 * catalog: one the server lacks just doesn't show until it has it.
 */
export function applyFavouritePush(
  db: SqlDb,
  userId: number,
  entries: WireFavourite[],
  games: readonly GameId[]
): FavouritePushResult[] {
  const find = db.prepare('SELECT * FROM favourites WHERE user_id = ? AND card_id = ?')
  const write = db.prepare(
    `INSERT INTO favourites (user_id, card_id, game, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ${NEXT_FAVOURITE_SEQ})
     ON CONFLICT(user_id, card_id) DO UPDATE SET game = excluded.game,
       created_at = excluded.created_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, seq = excluded.seq`
  )
  const applyOne = (f: WireFavourite): FavouritePushResult => {
    if (!games.includes(f.game)) return { cardId: f.cardId, status: 'skipped' }
    const existing = find.get(userId, f.cardId) as FavouriteRow | undefined
    if (existing) {
      const current = toWire(existing)
      if (JSON.stringify(current) === JSON.stringify(f))
        return { cardId: f.cardId, status: 'applied' }
      if (!replaces(f, current)) return { cardId: f.cardId, status: 'stale', current }
    } else if (f.deletedAt !== null) {
      // Nothing to delete; storing it would only grow the table.
      return { cardId: f.cardId, status: 'applied' }
    }
    write.run(userId, f.cardId, f.game, f.createdAt, f.updatedAt, f.deletedAt)
    return { cardId: f.cardId, status: 'applied' }
  }
  return db.transaction(() => entries.map(applyOne))()
}

/** The caller's favourites of `game` written after `cursor`, tombstones included, in seq order. */
export function favouritePullSince(
  db: SqlDb,
  userId: number,
  cursor: number,
  limit = MAX_PULL,
  game: GameId = 'ygo'
): FavouritePullResponse {
  const rows = db
    .prepare(
      'SELECT * FROM favourites WHERE user_id = ? AND game = ? AND seq > ? ORDER BY seq LIMIT ?'
    )
    .all(userId, game, cursor, limit + 1) as FavouriteRow[]
  const page = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    entries: page.map(toWire),
    cursor: pageCursor(
      db,
      page.at(-1)?.seq,
      more,
      cursor,
      'SELECT MAX(seq) AS top FROM favourites WHERE user_id = ?',
      userId
    ),
    more
  }
}
