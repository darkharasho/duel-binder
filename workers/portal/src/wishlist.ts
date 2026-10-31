import { RARITY_LABEL } from '../../../src/main/db/schema'
import type { SqlDb } from '../../../src/main/db/sql'
import { checkObject } from '../../../src/main/repo/args'
import { CollectionError } from '../../../src/main/repo/collection'
import { listWishlist } from '../../../src/main/repo/wishlist'
import {
  MAX_PULL,
  MAX_WANTED,
  replaces,
  type WireWish,
  type WishPullResponse,
  type WishPushResult
} from '../../../src/shared/cloud'
import { isGameId, type GameId } from '../../../src/shared/games'
import type { Language } from '../../../src/shared/languages'
import type { FriendWantsCard, WishlistItem, WishOwners } from '../../../src/shared/types'
import { toUser, type UserRow } from './friends'
import { NEXT_WISH_SEQ, userScope } from './scope'
import { MAX_PKEY, checkTime, pageCursor } from './sync'

/** SQL for `me`'s accepted friends; takes `me` twice. A block ends the friendship, so it counts too. */
const FRIEND_IDS = `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
                      FROM friendships
                     WHERE status = 'accepted' AND ? IN (requester_id, addressee_id)`

/** Validates a wishlist push body; throws CollectionError (a 400) on anything malformed. */
export function checkWishPush(body: unknown, now: Date): WireWish[] {
  const entries = (body as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) throw new CollectionError('entries must be an array')
  return entries.map((v): WireWish => {
    const o = checkObject(v, 'Entry')
    if (typeof o.pkey !== 'string' || o.pkey.length < 1 || o.pkey.length > MAX_PKEY)
      throw new CollectionError(`pkey must be a string of 1 to ${MAX_PKEY} characters`)
    if (!isGameId(o.game)) throw new CollectionError('game must be a game')
    const q = o.quantity
    if (q !== null && (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_WANTED))
      throw new CollectionError(`quantity must be null or a whole number from 1 to ${MAX_WANTED}`)
    return {
      pkey: o.pkey,
      game: o.game,
      quantity: q,
      createdAt: checkTime(o.createdAt, 'createdAt', now),
      updatedAt: checkTime(o.updatedAt, 'updatedAt', now),
      deletedAt: o.deletedAt === null ? null : checkTime(o.deletedAt, 'deletedAt', now)
    }
  })
}

interface WishRow {
  pkey: string
  game: GameId
  quantity: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

const toWire = (r: WishRow): WireWish => ({
  pkey: r.pkey,
  game: r.game,
  quantity: r.quantity,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/**
 * Applies pushed wishlist rows for `userId`, latest edit wins per printing. A row of a game outside
 * `games` is skipped, so the client keeps it and retries. The pkey isn't checked against the catalog:
 * a printing the server lacks just doesn't show until it has it.
 */
export function applyWishPush(
  db: SqlDb,
  userId: number,
  entries: WireWish[],
  games: readonly GameId[]
): WishPushResult[] {
  const find = db.prepare('SELECT * FROM wishlist_entries WHERE user_id = ? AND pkey = ?')
  const write = db.prepare(
    `INSERT INTO wishlist_entries (user_id, pkey, game, quantity, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${NEXT_WISH_SEQ})
     ON CONFLICT(user_id, pkey) DO UPDATE SET game = excluded.game, quantity = excluded.quantity,
       created_at = excluded.created_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, seq = excluded.seq`
  )
  const applyOne = (w: WireWish): WishPushResult => {
    if (!games.includes(w.game)) return { pkey: w.pkey, status: 'skipped' }
    const existing = find.get(userId, w.pkey) as WishRow | undefined
    if (existing) {
      const current = toWire(existing)
      if (JSON.stringify(current) === JSON.stringify(w)) return { pkey: w.pkey, status: 'applied' }
      if (!replaces(w, current)) return { pkey: w.pkey, status: 'stale', current }
    } else if (w.deletedAt !== null) {
      // Nothing to delete; storing it would only grow the table.
      return { pkey: w.pkey, status: 'applied' }
    }
    write.run(userId, w.pkey, w.game, w.quantity, w.createdAt, w.updatedAt, w.deletedAt)
    return { pkey: w.pkey, status: 'applied' }
  }
  return db.transaction(() => entries.map(applyOne))()
}

/** The caller's wishlist rows of `game` written after `cursor`, tombstones included, in seq order. */
export function wishPullSince(
  db: SqlDb,
  userId: number,
  cursor: number,
  limit = MAX_PULL,
  game: GameId = 'ygo'
): WishPullResponse {
  const rows = db
    .prepare(
      'SELECT * FROM wishlist_entries WHERE user_id = ? AND game = ? AND seq > ? ORDER BY seq LIMIT ?'
    )
    .all(userId, game, cursor, limit + 1) as WishRow[]
  const page = rows.slice(0, limit)
  const more = rows.length > limit
  return {
    entries: page.map(toWire),
    cursor: pageCursor(
      db,
      page.at(-1)?.seq,
      more,
      cursor,
      'SELECT MAX(seq) AS top FROM wishlist_entries WHERE user_id = ?',
      userId
    ),
    more
  }
}

export function wishlistVisible(db: SqlDb, userId: number): boolean {
  const row = db.prepare('SELECT wishlist_hidden FROM users WHERE id = ?').get(userId) as
    { wishlist_hidden: number } | undefined
  return row?.wishlist_hidden === 0
}

export function setWishlistVisible(db: SqlDb, userId: number, visible: unknown): void {
  if (typeof visible !== 'boolean') throw new CollectionError('visible must be true or false')
  db.prepare('UPDATE users SET wishlist_hidden = ? WHERE id = ?').run(visible ? 0 : 1, userId)
}

/**
 * What a friend still wants, for an accepted friend to read (the caller checks that): empty if they
 * hide their list. Printings they have as many copies of as they wanted are left out.
 */
export function friendWishlist(db: SqlDb, friend: number, game: GameId): WishlistItem[] {
  if (!wishlistVisible(db, friend)) return []
  return listWishlist(db, userScope(friend, game)).filter((w) => w.owned < (w.quantity ?? 1))
}

/**
 * `me`'s friends who want a card of `game` and don't hide their list; a printing they have enough
 * of doesn't count. One query, walking the friends' rows and checking each printing's card, as
 * card_printings has no index on card_id.
 */
export function friendsWanting(
  db: SqlDb,
  me: number,
  game: GameId,
  cardId: number
): FriendWantsCard[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar,
              p.set_code, ${RARITY_LABEL} AS set_rarity, p.language
         FROM wishlist_entries w
         JOIN users u ON u.id = w.user_id
         JOIN card_printings p ON p.pkey = w.pkey
        WHERE w.user_id IN (${FRIEND_IDS})
          AND u.wishlist_hidden = 0 AND w.game = ? AND w.deleted_at IS NULL
          AND +p.card_id = ?
          AND COALESCE(w.quantity, 1) > (SELECT COALESCE(SUM(e.quantity), 0) FROM collection_entries e
                                          WHERE e.user_id = w.user_id AND e.printing_id = p.id
                                            AND e.game = w.game AND e.deleted_at IS NULL)
        ORDER BY COALESCE(NULLIF(u.display_name, ''), u.username) COLLATE NOCASE, u.id, p.set_code, p.id`
    )
    .all(me, me, game, cardId) as (UserRow & {
    set_code: string
    set_rarity: string
    language: Language
  })[]
  const friends = new Map<number, FriendWantsCard>()
  for (const r of rows) {
    const friend = friends.get(r.id) ?? { ...toUser(r), printings: [] }
    friends.set(r.id, friend)
    friend.printings.push({ setCode: r.set_code, rarity: r.set_rarity, language: r.language })
  }
  return [...friends.values()]
}

/**
 * Which of `me`'s friends own each of `pkeys`, in one query. The list comes from the caller, so a
 * want still queued on a device is answered too. It reads friends' collections, which an accepted
 * friend can see anyway; wishlist privacy doesn't come into it.
 */
export function friendsOwning(db: SqlDb, me: number, game: GameId, pkeys: unknown): WishOwners[] {
  if (
    !Array.isArray(pkeys) ||
    pkeys.length > MAX_PULL ||
    !pkeys.every((k) => typeof k === 'string' && k.length <= MAX_PKEY)
  )
    throw new CollectionError(`pkeys must be at most ${MAX_PULL} printing keys`)
  const rows = db
    .prepare(
      `SELECT p.pkey, u.id, u.discord_id, u.username, u.display_name, u.avatar, SUM(e.quantity) AS n
         FROM card_printings p
         JOIN collection_entries e ON e.printing_id = p.id
         JOIN users u ON u.id = e.user_id
        WHERE p.pkey IN (SELECT value FROM json_each(?))
          AND +p.game = ? AND e.deleted_at IS NULL
          AND e.user_id IN (${FRIEND_IDS})
        GROUP BY p.pkey, e.user_id
        ORDER BY p.pkey, n DESC, u.id`
    )
    .all(JSON.stringify(pkeys), game, me, me) as (UserRow & { pkey: string; n: number })[]
  const owners = new Map<string, WishOwners>()
  for (const r of rows) {
    const row = owners.get(r.pkey) ?? { pkey: r.pkey, friends: [] }
    owners.set(r.pkey, row)
    row.friends.push({ ...toUser(r), quantity: r.n })
  }
  return [...owners.values()]
}
