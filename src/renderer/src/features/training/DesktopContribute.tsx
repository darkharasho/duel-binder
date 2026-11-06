import { useMemo } from 'react'
import { api } from '@/lib/api'
import type { GameId } from '@shared/games'
import { ContributeScreen, type TrainingDeps } from '../../../../phone/training/ContributeScreen'

/** The phone's Contribute photos screen, laid out for the desktop and sending through main. */
export default function DesktopContribute({
  game,
  userId,
  onClose
}: {
  game: GameId
  userId: number
  onClose(): void
}): React.JSX.Element {
  const deps = useMemo<TrainingDeps>(() => {
    const t = api.training!
    return {
      userId,
      upload: (id, label, jpeg) => t.upload(id, label, jpeg),
      remove: (id) => t.remove(id),
      summary: (g) => t.summary(g),
      serverIds: (ids) => t.serverIds(ids)
    }
  }, [userId])
  return <ContributeScreen game={game} onClose={onClose} deps={deps} layout="desktop" />
}
