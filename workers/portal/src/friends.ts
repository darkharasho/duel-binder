import { CollectionError } from '../../../src/main/repo/collection'
import type { SqlDb } from '../../../src/main/db/sql'
import type {
  Friend,
  FriendRequest,
  FriendRequestResult,
  FriendsOverview,
  FriendUser
} from '../../../src/shared/types'
import type { GameId } from '../../../src/shared/games'
import { avatarUrl } from './auth'

/** A friend-request problem the caller can fix; rpc.ts answers it as a 400. */
export class FriendError extends CollectionError {}

/** New requests one user may send in a rolling day; repeats to a pending request don't count. */
export const DAILY_REQUEST_LIMIT = 20
const DAY_MS = 24 * 60 * 60 * 1000

export interface UserRow {
  id: number
  discord_id: string
  username: string
  display_name: string | null
  avatar: string | null
}

export const toUser = (r: UserRow): FriendUser => ({
  id: r.id,
  username: r.username,
  // Discord sends '' for an unset global name; show the username then.
  displayName: r.display_name || null,
  avatarUrl: avatarUrl(r.discord_id, r.avatar)
})

/** `me`'s friends, requests and blocks; each friend's card count and latest change are for `game` only. */
export function friendsOverview(db: SqlDb, me: number, game: GameId): FriendsOverview {
  const friends = (
    db
      .prepare(
        `SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar,
                COALESCE(c.cards, 0) AS cards, c.updated AS updated
           FROM friendships f
           JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
           LEFT JOIN (SELECT user_id,
                             SUM(CASE WHEN deleted_at IS NULL THEN quantity ELSE 0 END) AS cards,
                             MAX(updated_at) AS updated
                        FROM collection_entries
                       WHERE game = ?
                         AND user_id IN (SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
                                           FROM friendships
                                          WHERE status = 'accepted' AND ? IN (requester_id, addressee_id))
                       GROUP BY user_id) c ON c.user_id = u.id
          WHERE f.status = 'accepted' AND ? IN (f.requester_id, f.addressee_id)
          ORDER BY COALESCE(NULLIF(u.display_name, ''), u.username) COLLATE NOCASE, u.id`
      )
      .all(me, game, me, me, me) as (UserRow & { cards: number; updated: string | null })[]
  ).map((r): Friend => ({ ...toUser(r), cardCount: r.cards, updatedAt: r.updated }))
  const incoming = (
    db
      .prepare(
        `SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar, f.created_at AS sent
           FROM friendships f JOIN users u ON u.id = f.requester_id
          WHERE f.addressee_id = ? AND f.status = 'pending'
          ORDER BY f.created_at DESC, u.id`
      )
      .all(me) as (UserRow & { sent: string })[]
  ).map((r): FriendRequest => ({ ...toUser(r), sentAt: r.sent }))
  const blocked = (
    db
      .prepare(
        `SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar
           FROM friend_blocks b JOIN users u ON u.id = b.blocked_id
          WHERE b.blocker_id = ?
          ORDER BY COALESCE(NULLIF(u.display_name, ''), u.username) COLLATE NOCASE, u.id`
      )
      .all(me) as UserRow[]
  ).map(toUser)
  return { friends, incoming, blocked }
}

function blocks(db: SqlDb, blocker: number, blocked: number): boolean {
  return (
    db
      .prepare('SELECT 1 FROM friend_blocks WHERE blocker_id = ? AND blocked_id = ?')
      .get(blocker, blocked) !== undefined
  )
}

export function requestFriend(
  db: SqlDb,
  me: number,
  username: string,
  now: Date
): FriendRequestResult {
  const name = username.trim()
  if (!name) throw new FriendError('Enter a username')
  const target = db
    .prepare(
      'SELECT id, discord_id, username, display_name, avatar FROM users WHERE username = ? COLLATE NOCASE'
    )
    .get(name) as UserRow | undefined
  if (!target) throw new FriendError(`No Duel Binder user called "${name}"`)
  if (target.id === me) throw new FriendError("That's you")
  if (blocks(db, me, target.id))
    throw new FriendError(`You've blocked ${target.username}. Unblock them first.`)
  // Someone who blocked you gets nothing, but you're told it was sent, as with any request.
  if (blocks(db, target.id, me)) return { status: 'sent' }
  const row = db
    .prepare(
      `SELECT requester_id, status FROM friendships
        WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
    )
    .get(me, target.id, target.id, me) as { requester_id: number; status: string } | undefined
  if (row?.status === 'accepted')
    throw new FriendError(`You're already friends with ${target.username}`)
  if (row && row.requester_id === target.id) {
    acceptFriend(db, me, target.id, now)
    return { status: 'accepted', friend: toUser(target) }
  }
  if (!row) {
    const ts = now.toISOString()
    const since = new Date(now.getTime() - DAY_MS).toISOString()
    db.prepare('DELETE FROM friend_request_log WHERE user_id = ? AND created_at <= ?').run(
      me,
      since
    )
    const { n } = db
      .prepare('SELECT count(*) AS n FROM friend_request_log WHERE user_id = ?')
      .get(me) as { n: number }
    if (n >= DAILY_REQUEST_LIMIT)
      throw new FriendError("You've sent a lot of friend requests today. Try again tomorrow.")
    db.prepare('INSERT INTO friend_request_log (user_id, created_at) VALUES (?, ?)').run(me, ts)
    db.prepare(
      "INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)"
    ).run(me, target.id, ts, ts)
  }
  return { status: 'sent' }
}

export function acceptFriend(db: SqlDb, me: number, requesterId: number, now: Date): void {
  const r = db
    .prepare(
      "UPDATE friendships SET status = 'accepted', updated_at = ? WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'"
    )
    .run(now.toISOString(), requesterId, me)
  if (r.changes === 0) throw new FriendError('No friend request to accept')
}

export function ignoreFriend(db: SqlDb, me: number, requesterId: number): void {
  db.prepare(
    "DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'"
  ).run(requesterId, me)
}

export function removeFriend(db: SqlDb, me: number, friendId: number): void {
  db.prepare(
    `DELETE FROM friendships WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`
  ).run(me, friendId, friendId, me)
}

export function areFriends(db: SqlDb, me: number, other: number): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM friendships WHERE status = 'accepted'
          AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`
      )
      .get(me, other, other, me) !== undefined
  )
}

/** Ends any friendship or request between the two and stops `userId` reaching `me`. */
export function blockUser(db: SqlDb, me: number, userId: number, now: Date): void {
  if (userId === me) throw new FriendError("You can't block yourself")
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId))
    throw new FriendError('No such user')
  db.prepare(
    `DELETE FROM friendships
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
  ).run(me, userId, userId, me)
  db.prepare(
    'INSERT OR IGNORE INTO friend_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)'
  ).run(me, userId, now.toISOString())
}

/** Lifts the block; the friendship isn't restored. */
export function unblockUser(db: SqlDb, me: number, userId: number): void {
  db.prepare('DELETE FROM friend_blocks WHERE blocker_id = ? AND blocked_id = ?').run(me, userId)
}
