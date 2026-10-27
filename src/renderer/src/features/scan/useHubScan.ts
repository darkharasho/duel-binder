import { useEffect, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Language } from '@shared/languages'
import { api } from '@/lib/api'
import type { ScanEngine } from './engine'
import { useScanHub } from './ScanHub'
import { useScanLoop, type ScanLoop } from './useScanLoop'

const ANY = 'any'

/**
 * Scans `stream` (shown in `videoRef`) with the hub's settings, counting pulls through the hub:
 * the in-page scanner of the desktop Scan page and the phone scanner. `setUnreadable`: the picked
 * set's printings couldn't be read, so cards are matched against every set.
 */
export function useHubScan({
  videoRef,
  stream,
  engineFactory
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  stream: MediaStream | null
  engineFactory: () => ScanEngine
}): { loop: ScanLoop; setUnreadable: boolean } {
  const { settings, count } = useScanHub()
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

  const loop = useScanLoop({
    videoRef,
    engineFactory,
    running: stream !== null,
    setName: scanSet?.setName ?? null,
    setKey: scanSet ? `${scanSet.language}|${scanSet.setName}` : ANY,
    setPrintings: scanSet === null ? null : setPrintings.data,
    defaultRarity: settings.defaultRarity,
    onDraft: count
  })

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = stream
  }, [videoRef, stream])

  return { loop, setUnreadable }
}
