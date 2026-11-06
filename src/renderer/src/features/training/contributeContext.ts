import { createContext, useContext } from 'react'
import type { GameId } from '@shared/games'

export interface ContributeState {
  /** The game open to testers only that this account may see, if any: its photos are wanted. */
  testerGame: GameId | undefined
  open(game: GameId): void
}

export const ContributeContext = createContext<ContributeState>({
  testerGame: undefined,
  open: () => {}
})

/** Contribute photos (training photos for a tester game), for the desktop's sidebar and Settings. */
export const useContribute = (): ContributeState => useContext(ContributeContext)
