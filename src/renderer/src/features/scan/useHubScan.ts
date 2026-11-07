import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { GameId } from '@shared/games/types'
import type { LookModel } from '@shared/scan/look'
import type { TiltModel } from '@shared/scan/tilt'
import { liveLanguage, type ScanSet } from '@shared/scanWindow'
import { printedLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { useGame } from '@/lib/game'
import { playScanPing } from '@/lib/scanPing'
import type { EngineFactory } from './engine'
import type { ScanDraft } from './resolve'
import { useScanHub } from './ScanHub'
import { useScanLoop, type ScanLoop } from './useScanLoop'
import { pullOf, type Pull } from './window/overlay'
import { useScanSets } from './setPrintings'

/**
 * Scans `stream` (shown in `videoRef`) for the game shown with the hub's settings, counting pulls
 * through the hub: the in-page scanner of the desktop Scan page and the phone scanner. `setUnreadable`: none of the
 * picked sets' printings could be read, so cards are matched against every set; `setsSkipped`:
 * picked sets left out because theirs couldn't be, while the others scan. `lookModel`: the
 * rarity look model, which only the phone scanner uses (see useScanLoop). `tiltModels`: the
 * tilt-to-read-rarity models; a scanner given none never holds a card for a tilt (Stream mode).
 */
export function useHubScan({
  videoRef,
  stream,
  engineFactory,
  lookModel = null,
  tiltModels = null,
  onStalled,
  paused = false,
  onPull,
  wholeFrame = false
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  stream: MediaStream | null
  engineFactory: EngineFactory
  lookModel?: LookModel | null
  tiltModels?: Partial<Record<GameId, TiltModel>> | null
  /** The camera's picture froze; see useScanLoop. */
  onStalled?: () => void
  /** Stops scanning while the camera keeps showing (a stream screen that isn't live). */
  paused?: boolean
  /** As useScanLoop's: the desktop webcam's. */
  wholeFrame?: boolean
  /** Hears each pull once it's counted: `pull.id` is the row key, `scanned` the copies on the list. */
  onPull?: (pull: Pull, scanned: number, draft: ScanDraft) => void
}): {
  loop: ScanLoop
  setUnreadable: boolean
  setsSkipped: ScanSet[]
  found: Pull | null
} {
  const { settings, count, reread, session } = useScanHub()
  const { copiesOf } = session
  const { game } = useGame()
  const { setKey, setPrintings, setUnreadable, setsSkipped } = useScanSets(settings.sets)

  // The latest card found, for the "found it" moment; a new key each time replays it.
  const [found, setFound] = useState<Pull | null>(null)
  const foundRef = useRef<Pull | null>(null)
  const onDraft = useCallback(
    (draft: ScanDraft): string => {
      const id = count(draft)
      playScanPing()
      const pull = { ...pullOf(draft, settings.hitPrice, (foundRef.current?.key ?? 0) + 1), id }
      foundRef.current = pull
      setFound(pull)
      onPull?.(pull, copiesOf(draft), draft)
      return id
    },
    [count, copiesOf, onPull, settings.hitPrice]
  )

  const [filter] = useLanguageFilter()
  const loop = useScanLoop({
    videoRef,
    engineFactory,
    game,
    running: stream !== null && !paused,
    setKey,
    setPrintings,
    defaultRarity: settings.defaultRarity,
    language: game === 'pkm' ? liveLanguage(settings) : null,
    filterLanguage: game === 'ygo' || game === 'op' ? printedLanguage(filter) : null,
    lookModel,
    tiltModels,
    onDraft,
    onRarityRead: reread,
    onStalled,
    wholeFrame
  })

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = stream
  }, [videoRef, stream])

  return { loop, setUnreadable, setsSkipped, found }
}
