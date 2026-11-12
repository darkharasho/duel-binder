import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useAccountUser } from '@/lib/accountUser'
import { useGame } from '@/lib/game'
import type { GameId } from '@shared/games'
import { ContributeContext, contributeGame } from './contributeContext'

// Loaded on demand: it pulls in the camera and the number reader.
const DesktopContribute = lazy(() => import('./DesktopContribute'))

/**
 * The desktop's Contribute photos screen, over the pages (under the title bar). It shows the tester
 * game while open and goes back to the game shown before when it closes. Photos left waiting from
 * an earlier run are sent when the app starts.
 */
export function ContributeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { game, available, setGame } = useGame()
  const { user } = useAccountUser()
  const testerGame = api.training ? contributeGame(game, available) : undefined
  const [shown, setShown] = useState<GameId | null>(null)
  const back = useRef<GameId | null>(null)

  const open = (g: GameId): void => {
    back.current = g === game ? null : game
    void setGame(g).then(() => setShown(g))
  }
  const close = (): void => {
    setShown(null)
    const g = back.current
    back.current = null
    if (g !== null) void setGame(g)
  }

  const userId = user?.id
  useEffect(() => {
    if (userId === undefined || !api.training || typeof indexedDB === 'undefined') return
    void import('../../../../phone/training/outbox')
      .then(({ trainingOutbox }) => {
        const t = api.training!
        return trainingOutbox().drain(userId, { upload: t.upload, remove: t.remove })
      })
      .catch(() => undefined)
  }, [userId])

  return (
    <ContributeContext.Provider value={{ testerGame, open }}>
      {children}
      {shown !== null && userId !== undefined && (
        <div className="fixed inset-x-0 bottom-0 top-9 z-50">
          <Suspense fallback={<div className="size-full bg-background" />}>
            <DesktopContribute game={shown} userId={userId} onClose={close} />
          </Suspense>
        </div>
      )}
    </ContributeContext.Provider>
  )
}
