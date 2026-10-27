import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Language } from '@shared/languages'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { defaultEngine, type ScanEngine } from './engine'
import { useScanHub } from './ScanHub'
import { NO_FINGERPRINTS, SET_UNREADABLE, statusText } from './scanText'
import { useCamera, type CameraError } from './useCamera'
import { useScanLoop } from './useScanLoop'

const ANY = 'any'

const CAMERA_MESSAGES: Record<CameraError, string> = {
  denied: 'Camera access was denied. Allow it in your system settings, then reopen Scan.',
  none: 'No camera found. Plug one in and reopen Scan.',
  lost: "The camera stopped. Check it's connected, then pick it again."
}

/** What the page's camera picker needs from the in-page camera. */
export interface InPageCamera {
  devices: MediaDeviceInfo[]
  /** The camera that's open, else the chosen one, else ''. */
  openDeviceId: string
  error: CameraError | null
  retry: () => void
}

/**
 * The Scan page's own scanner: camera preview, outline, status and the recognition loop. It
 * owns the camera, so unmounting it (leaving the page, or opening the scan window) releases it.
 * Pulls go through the hub, like the scan window's. `controls` render under the preview.
 */
export function InPageScanner({
  engineFactory = defaultEngine,
  onCamera,
  controls
}: {
  engineFactory?: () => ScanEngine
  onCamera: (camera: InPageCamera | null) => void
  controls: React.ReactNode
}): React.JSX.Element {
  const { settings, count } = useScanHub()
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(settings.deviceId)

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
    running: camera.stream !== null,
    setName: scanSet?.setName ?? null,
    setKey: scanSet ? `${scanSet.language}|${scanSet.setName}` : ANY,
    setPrintings: scanSet === null ? null : setPrintings.data,
    defaultRarity: settings.defaultRarity,
    onDraft: count
  })

  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = camera.stream
  }, [camera.stream])

  const { devices, error, retry, stream } = camera
  const openDeviceId =
    stream?.getVideoTracks()[0]?.getSettings().deviceId ?? settings.deviceId ?? ''
  useEffect(() => {
    onCamera({ devices, openDeviceId, error, retry })
  }, [onCamera, devices, openDeviceId, error, retry])
  useEffect(() => () => onCamera(null), [onCamera])

  const outline = loop.outline

  return (
    <section aria-label="Camera" className="flex w-min shrink-0 flex-col gap-3">
      <div className="relative aspect-[3/4] h-[calc(100vh-15rem)] min-h-72 overflow-hidden rounded-lg border-2 border-white/10 bg-black">
        {camera.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>{CAMERA_MESSAGES[camera.error]}</p>
            {camera.error !== 'denied' && (
              <Button variant="outline" size="sm" onClick={camera.retry}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover object-center"
            />
            {outline && (
              <svg
                aria-hidden
                viewBox={`0 0 ${outline.width} ${outline.height}`}
                preserveAspectRatio="xMidYMid slice"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                <polygon
                  points={outline.quad.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke="#34d399"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/70 px-4 py-2 text-sm text-white">
              <p role="status">{statusText(loop.status)}</p>
              {loop.status.kind === 'stopped' && (
                <Button variant="outline" size="xs" className="ml-auto" onClick={loop.retry}>
                  Retry
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      {setUnreadable && <p className="text-xs text-muted-foreground">{SET_UNREADABLE}</p>}
      {loop.artReady === false && (
        <p className="text-xs text-muted-foreground">{NO_FINGERPRINTS}</p>
      )}
      {controls}
    </section>
  )
}
