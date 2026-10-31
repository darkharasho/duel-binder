import { afterEach, beforeEach } from 'vitest'
import { GAMES } from '../../src/shared/games'

/** Pokémon is open to everyone now; this makes it owner-only again, to test the access gate. */
export function withOwnerOnlyPokemon(): void {
  beforeEach(() => {
    GAMES.pkm.access = 'owner'
  })
  afterEach(() => {
    GAMES.pkm.access = 'everyone'
  })
}
