import { afterEach, beforeEach } from 'vitest'
import { GAMES, type GameId } from '../../src/shared/games'
import type { GameDef } from '../../src/shared/games/types'

/** Sets a game's access for each test in the suite, then restores the shipped value. Use it to test the access gate. */
export function withGameAccess(game: GameId, access: GameDef['access']): void {
  let original: GameDef['access']
  beforeEach(() => {
    original = GAMES[game].access
    GAMES[game].access = access
  })
  afterEach(() => {
    GAMES[game].access = original
  })
}

/** Pokémon is open to everyone now; this makes it owner-only again, to test the access gate. */
export function withOwnerOnlyPokemon(): void {
  withGameAccess('pkm', 'owner')
}
