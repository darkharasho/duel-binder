import { PKM } from './pokemon'
import { GAME_IDS, type GameDef, type GameId } from './types'
import { YGO } from './ygo'

export * from './types'
export * from './ids'

export const GAMES: Record<GameId, GameDef> = { ygo: YGO, pkm: PKM }

export function gameDef(id: GameId): GameDef {
  return GAMES[id]
}

export function isGameId(x: unknown): x is GameId {
  return typeof x === 'string' && (GAME_IDS as readonly string[]).includes(x)
}

/** Every game open to everyone, plus the owner-only ones when `isOwner`, in GAME_IDS order. */
export function allowedGames(isOwner: boolean): GameId[] {
  return GAME_IDS.filter((id) => GAMES[id].access === 'everyone' || isOwner)
}
