import type { GameId } from '@shared/games'

/** The list key for a game's sessions; mutations invalidate the `['sessions']` prefix. */
export const sessionsKey = (game: GameId): readonly ['sessions', GameId] => ['sessions', game]
