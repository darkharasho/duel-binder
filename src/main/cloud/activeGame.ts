import { gamesOf, type Me } from '../../shared/cloud'
import { isGameId, type GameId } from '../../shared/games'
import { getMeta, setMeta } from '../db/meta'
import type { SqlDb } from '../db/sql'
import type { CloudClient } from './client'

/**
 * Makes the stored `active_game` one of `available`: a game not in it (or not a game at all) is
 * replaced with 'ygo', so the SQL reads (ACTIVE_GAME) never scope to a game the account can't use.
 * Returns whether it replaced one.
 */
export function checkActiveGame(db: SqlDb, available: readonly GameId[]): boolean {
  const stored = getMeta(db, 'active_game')
  if (stored === null || (isGameId(stored) && available.includes(stored))) return false
  setMeta(db, 'active_game', 'ygo')
  return true
}

/** The game this device shows: the stored one when `available` has it, otherwise 'ygo' (written back). */
export function activeGame(db: SqlDb, available: readonly GameId[]): GameId {
  checkActiveGame(db, available)
  const stored = getMeta(db, 'active_game')
  return isGameId(stored) ? stored : 'ygo'
}

/** Stores the game this device shows; throws for one not in `available`. */
export function setActiveGame(db: SqlDb, available: readonly GameId[], game: unknown): void {
  if (!isGameId(game) || !available.includes(game))
    throw new Error(`${String(game)} isn't available on this account`)
  setMeta(db, 'active_game', game)
}

/** `client`, with every `me()` answer also handed to `onMe` (to keep the cached account's games fresh). */
export function reportingMe(client: CloudClient, onMe: (me: Me) => void): CloudClient {
  return {
    ...client,
    me: async () => {
      const me = await client.me()
      onMe(me)
      return me
    }
  }
}

/**
 * `user` with the games of a fresher `me` of the same account (no `games` when it has none), or null
 * when they're the games `user` already has.
 */
export function withGamesOf(user: Me, me: Me): Me | null {
  const now = gamesOf(me)
  const was = gamesOf(user)
  if (now.length === was.length && now.every((g, i) => g === was[i])) return null
  const next = { ...user }
  delete next.games
  if (me.games !== undefined) next.games = me.games
  return next
}
