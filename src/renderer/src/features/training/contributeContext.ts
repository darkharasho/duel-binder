import { createContext, useContext } from 'react'
import { GAMES, type GameId } from '@shared/games'

export interface ContributeState {
  /** The game open to testers only that this account may see, if any: its photos are wanted. */
  testerGame: GameId | undefined
  open(game: GameId): void
}

export const ContributeContext = createContext<ContributeState>({
  testerGame: undefined,
  open: () => {}
})

/**
 * The game Contribute photos opens: the one shown when it's open to testers only, else the first
 * such game this account may see, else none.
 */
export function contributeGame(current: GameId, available: readonly GameId[]): GameId | undefined {
  const tester = (g: GameId): boolean => GAMES[g].access === 'testers'
  if (available.includes(current) && tester(current)) return current
  return available.find(tester)
}

/** Contribute photos (training photos for a tester game), for the desktop's sidebar and Settings. */
export const useContribute = (): ContributeState => useContext(ContributeContext)
