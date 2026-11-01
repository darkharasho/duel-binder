import { useEffect, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Language } from '@shared/languages'
import type { LookModel } from '@shared/scan/look'
import { liveLanguage } from '@shared/scanWindow'
import { printedLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { api } from '@/lib/api'
import { useGame } from '@/lib/game'
import type { EngineFactory } from './engine'
import { useScanHub } from './ScanHub'
import { useScanLoop, type ScanLoop } from './useScanLoop'

const ANY = 'any'

/**
 * Scans `stream` (shown in `videoRef`) for the game shown with the hub's settings, counting pulls
 * through the hub: the in-page scanner of the desktop Scan page and the phone scanner. `setUnreadable`: the picked
 * set's printings couldn't be read, so cards are matched against every set. `lookModel`: the
 * rarity look model, which only the phone scanner uses (see useScanLoop).
 */
export function useHubScan({
  videoRef,
  stream,
  engineFactory,
  lookModel = null,
  onStalled
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  stream: MediaStream | null
  engineFactory: EngineFactory
  lookModel?: LookModel | null
  /** The camera's picture froze; see useScanLoop. */
  onStalled?: () => void
}): { loop: ScanLoop; setUnreadable: boolean } {
  const { settings, count } = useScanHub()
  const { game } = useGame()
  const picked = settings.set
  const setPrintings = useQuery({
    queryKey: ['scan', 'setPrintings', picked?.setName, picked?.language as Language | undefined],
    queryFn: () => api.scan.printingsForSet(picked!.setName, picked!.language),
    enabled: picked !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false
  })
  // A set whose printings can't be read scans as any set rather than not at all.
  const setUnreadable = picked !== null && setPrintings.isError
  const scanSet = setUnreadable ? null : picked

  const [filter] = useLanguageFilter()
  const loop = useScanLoop({
    videoRef,
    engineFactory,
    game,
    running: stream !== null,
    setName: scanSet?.setName ?? null,
    setKey: scanSet ? `${scanSet.language}|${scanSet.setName}` : ANY,
    setPrintings: scanSet === null ? null : setPrintings.data,
    defaultRarity: settings.defaultRarity,
    language: game === 'pkm' ? liveLanguage(settings) : null,
    filterLanguage: game === 'ygo' ? printedLanguage(filter) : null,
    lookModel,
    onDraft: count,
    onStalled
  })

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = stream
  }, [videoRef, stream])

  return { loop, setUnreadable }
}
