import { useEffect, useRef } from 'react'
import { defaultEngine, type EngineFactory } from './engine'
import { useScanHub } from './ScanHub'
import { FoundBurst } from './FoundBurst'
import { ScanViewport } from './ScanViewport'
import { ArtDataNotice } from './ArtDataNotice'
import { SET_UNREADABLE } from './scanText'
import { useCamera, type CameraError } from './useCamera'
import { useHubScan } from './useHubScan'

const CAMERA_MESSAGES: Record<CameraError, string> = {
  denied: 'Camera access was denied. Allow it in your system settings, then reopen Scan.',
  none: 'No camera found. Plug one in and reopen Scan.',
  lost: "The camera stopped. Check it's connected, then pick it again.",
  busy: 'The camera is in use by another app. Close it there, then try again.'
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
  engineFactory?: EngineFactory
  onCamera: (camera: InPageCamera | null) => void
  controls: React.ReactNode
}): React.JSX.Element {
  const { settings } = useScanHub()
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(settings.deviceId)
  const { loop, setUnreadable, found } = useHubScan({
    videoRef,
    stream: camera.stream,
    engineFactory,
    onStalled: camera.retry
  })

  const { devices, error, retry, stream } = camera
  const openDeviceId =
    stream?.getVideoTracks()[0]?.getSettings().deviceId ?? settings.deviceId ?? ''
  useEffect(() => {
    onCamera({ devices, openDeviceId, error, retry })
  }, [onCamera, devices, openDeviceId, error, retry])
  useEffect(() => () => onCamera(null), [onCamera])

  return (
    <section aria-label="Camera" className="flex w-min shrink-0 flex-col gap-3">
      <ScanViewport
        videoRef={videoRef}
        error={camera.error}
        messages={CAMERA_MESSAGES}
        onRetryCamera={camera.retry}
        loop={loop}
        className="aspect-[3/4] h-[calc(100vh-15rem)] min-h-72 rounded-lg border-2 border-white/10"
      >
        {found && <FoundBurst key={found.key} name={found.name} price={found.price} />}
      </ScanViewport>
      {setUnreadable && <p className="text-xs text-muted-foreground">{SET_UNREADABLE}</p>}
      {loop.artReady === false && <ArtDataNotice status={loop.artData} />}
      {controls}
    </section>
  )
}
