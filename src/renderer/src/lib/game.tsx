/* eslint-disable react-refresh/only-export-components -- the provider and its hook belong together */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { GAMES, gameOfId, type CardAspect, type GameDef, type GameId } from '@shared/games'
import { api } from '@/lib/api'

export interface GameState {
  /** The game every page shows. */
  game: GameId
  def: GameDef
  /** The games this account may switch between; the switch shows only with more than one. */
  available: GameId[]
  setGame(g: GameId): Promise<void>
}

/**
 * Query key roots that are the same whichever game shows (the account, sync and app status), so
 * a game switch keeps them; every other query is reset. A root belongs here only if nothing under
 * it depends on the game: a game's rows kept here would show under the other game. The list is
 * pinned by a test (game-switch.test.tsx), so adding to it is a deliberate edit.
 */
export const GAME_FREE: ReadonlySet<string> = new Set([
  'account',
  'sync',
  'me',
  'update',
  'app',
  'images',
  'phone'
])

const YGO_ONLY: { game: GameId; available: GameId[] } = { game: 'ygo', available: ['ygo'] }

/** Outside a provider (a page rendered on its own, in tests) everything is Yu-Gi-Oh!. */
const GameContext = createContext<GameState>({
  ...YGO_ONLY,
  def: GAMES.ygo,
  setGame: async () => {}
})

export const useGame = (): GameState => useContext(GameContext)

/**
 * The aspect of a card's art frame: the card's own game's, read from its id (a Pokémon id is in its
 * own range, so a friend's or a scanned card of either game is framed right), else the game shown.
 */
export function useCardAspect(imageId?: number): CardAspect {
  const { game } = useGame()
  return GAMES[imageId !== undefined && imageId > 0 ? gameOfId(imageId) : game].cardAspect
}

/** Whether a page is in this game: Scan and Rip are only for a game that has them. */
export function pageInGame(page: string, def: GameDef): boolean {
  return (page !== 'scan' || def.features.scan) && (page !== 'rip' || def.features.rip)
}

/**
 * Knows the game shown and the games available, from `api.games`. It reads them again after any
 * data or account change (a sign-in, sign-out or deleted account can reset the game), and when
 * the game differs from the one shown it resets every game's query, so no page keeps the old
 * game's rows. With a `fallback`, that shows until the first read lands and no page reads before it.
 */
export function GameProvider({
  children,
  fallback
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}): React.JSX.Element {
  const qc = useQueryClient()
  const [known, setKnown] = useState<typeof YGO_ONLY | null>(null)
  const shown = useRef<GameId | null>(null)
  // Reads can overlap (a switch and its data-changed event); only the latest one lands.
  const reads = useRef(0)
  const fellBack = useRef(false)

  const read = useCallback(async (): Promise<void> => {
    const n = ++reads.current
    let next = YGO_ONLY
    try {
      const [available, game] = await Promise.all([api.games.available(), api.games.active()])
      next = { game, available }
      fellBack.current = false
    } catch {
      // Unreadable (offline web, a failed IPC): Yu-Gi-Oh!, which every account has. The requests
      // must agree with the page, so the app is asked to show Yu-Gi-Oh! too (the web api already
      // falls back to it on its own; this is for main and the phone's store). Once per failure
      // run: the phone's setActive always fires a data change, which reads again.
      if (!fellBack.current) {
        fellBack.current = true
        await api.games.setActive('ygo').catch(() => {})
      }
    }
    if (n !== reads.current) return
    const before = shown.current
    shown.current = next.game
    setKnown((k) =>
      k && k.game === next.game && k.available.join() === next.available.join() ? k : next
    )
    // Query keys don't name the game, so the old game's rows are dropped, not just refetched.
    if (before !== null && before !== next.game)
      void qc.resetQueries({ predicate: (q) => !GAME_FREE.has(String(q.queryKey[0])) })
  }, [qc])

  useEffect(() => {
    void read()
    const offData = api.app.onDataChanged(() => void read())
    const offAccount = api.account.onChange(() => void read())
    return () => {
      offData()
      offAccount()
    }
  }, [read])

  const setGame = useCallback(
    async (g: GameId): Promise<void> => {
      await api.games.setActive(g)
      await read()
    },
    [read]
  )

  const value = useMemo<GameState>(() => {
    const { game, available } = known ?? YGO_ONLY
    return { game, available, def: GAMES[game], setGame }
  }, [known, setGame])

  if (!known && fallback !== undefined) return <>{fallback}</>
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}
