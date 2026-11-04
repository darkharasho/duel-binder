import { ONE_PIECE } from './onePiece'
import { PKM } from './pokemon'
import { GAME_IDS, type GameDef, type GameId, type ViewerFacts } from './types'
import { YGO } from './ygo'

export * from './types'
export * from './ids'

export const GAMES: Record<GameId, GameDef> = { ygo: YGO, pkm: PKM, op: ONE_PIECE }

export function gameDef(id: GameId): GameDef {
  return GAMES[id]
}

export function isGameId(x: unknown): x is GameId {
  return typeof x === 'string' && (GAME_IDS as readonly string[]).includes(x)
}

/**
 * The games a viewer sees, in GAME_IDS order: 'everyone' games, every game for the owner, and
 * 'testers' games the viewer is listed for. An 'owner' game goes to the owner only.
 */
export function allowedGames(viewer: ViewerFacts): GameId[] {
  return GAME_IDS.filter((id) => {
    const access = GAMES[id].access
    if (access === 'everyone' || viewer.isOwner) return true
    return access === 'testers' && viewer.testerGames.includes(id)
  })
}

/** The exhaustive per-game value: a missing game is a compile error. */
export function byGame<T>(game: GameId, values: Record<GameId, T>): T {
  return values[game]
}
