import { RARITY_LABEL } from '../../../src/main/db/schema'
import type { SqlDb } from '../../../src/main/db/sql'
import type { GameId } from '../../../src/shared/games'
import type { FriendCardCopies } from '../../../src/shared/types'
import type { Language } from '../../../src/shared/languages'
import { toUser, type UserRow } from './friends'

/**
 * `me`'s friends who have a card of `game`, with their copies per printing; most copies first.
 * One query: it walks the friends' live entries (ux_entries_live) and checks each printing's card,
 * as card_printings has no index on card_id. Only accepted friendships count, and a block ends the
 * friendship. Notes and entries' other details stay out, as in a friend's binder.
 */
export function friendsWithCard(
  db: SqlDb,
  me: number,
  game: GameId,
  cardId: number
): FriendCardCopies[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar,
              p.set_code, ${RARITY_LABEL} AS set_rarity, p.language, SUM(e.quantity) AS n
         FROM collection_entries e
         JOIN card_printings p ON p.id = e.printing_id
         JOIN users u ON u.id = e.user_id
        WHERE e.user_id IN (SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
                              FROM friendships
                             WHERE status = 'accepted' AND ? IN (requester_id, addressee_id))
          AND e.game = ? AND e.deleted_at IS NULL
          AND +p.card_id = ?
        GROUP BY e.user_id, p.id
        ORDER BY p.set_code, p.id`
    )
    .all(me, me, game, cardId) as (UserRow & {
    set_code: string
    set_rarity: string
    language: Language
    n: number
  })[]
  const friends = new Map<number, FriendCardCopies>()
  for (const r of rows) {
    const friend = friends.get(r.id) ?? { ...toUser(r), quantity: 0, printings: [] }
    friends.set(r.id, friend)
    friend.quantity += r.n
    friend.printings.push({
      setCode: r.set_code,
      rarity: r.set_rarity,
      language: r.language,
      quantity: r.n
    })
  }
  const shownName = (f: FriendCardCopies): string => f.displayName ?? f.username
  return [...friends.values()].sort(
    (a, b) => b.quantity - a.quantity || shownName(a).localeCompare(shownName(b))
  )
}
