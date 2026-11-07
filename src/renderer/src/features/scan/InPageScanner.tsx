import { useCallback, useEffect, useRef, useState } from 'react'
import { TILT_MODELS } from '@shared/scan/tiltModel'
import type { CameraResolution } from '@shared/scanWindow'
import { defaultEngine, type EngineFactory } from './engine'
import { useScanHub } from './ScanHub'
import { FoundBurst } from './FoundBurst'
import { clampZoom, ScanViewport, ZoomSlider } from './ScanViewport'
import { ArtDataNotice } from './ArtDataNotice'
import { SET_UNREADABLE, setsSkippedText } from './scanText'
import { cameraResolution, useCamera, type CameraError } from './useCamera'
import { useHubScan } from './useHubScan'

const CAMERA_MESSAGES: Record<CameraError, string> = {
  denied: 'Camera access was denied. Allow it in your system settings, then reopen Scan.',
  none: 'No camera found. Plug one in and reopen Scan.',
  lost: "The camera stopped. Check it's connected, then pick it again.",
  busy: 'The camera is in use by another app. Close it there, then try again.'
}

/**
 * The in-page picture's zoom. Its own, not the scan window's (settings.zoom): the page shows a
 * narrow portrait crop and the window a whole stream layout, so one zoom rarely suits both.
 */
const PAGE_ZOOM_KEY = 'scan.pageZoom'

function readPageZoom(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_ZOOM_KEY))
    return n >= 1 ? clampZoom(n) : 1
  } catch {
    return 1
  }
}

function usePageZoom(): [number, (zoom: number) => void] {
  const [zoom, setZoomState] = useState(readPageZoom)
  const setZoom = useCallback((next: number): void => {
    const z = clampZoom(next)
    setZoomState(z)
    try {
      localStorage.setItem(PAGE_ZOOM_KEY, String(z))
    } catch {
      // Unavailable storage only costs the remembered zoom.
    }
  }, [])
  return [zoom, setZoom]
}

/** What the page's camera picker needs from the in-page camera. */
export interface InPageCamera {
  devices: MediaDeviceInfo[]
  /** The camera that's open, else the chosen one, else ''. */
  openDeviceId: string
  error: CameraError | null
  retry: () => void
  /** What the open camera really delivers; null while none is open. */
  resolution: CameraResolution | null
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
  const [zoom, setZoom] = usePageZoom()
  const { loop, setUnreadable, setsSkipped, found } = useHubScan({
    videoRef,
    stream: camera.stream,
    engineFactory,
    tiltModels: TILT_MODELS,
    onStalled: camera.retry,
    wholeFrame: true
  })

  const { devices, error, retry, stream } = camera
  const openDeviceId =
    stream?.getVideoTracks()[0]?.getSettings().deviceId ?? settings.deviceId ?? ''
  const res = cameraResolution(stream)
  const { width = 0, height = 0, frameRate = null } = res ?? {}
  useEffect(() => {
    const resolution = width ? { width, height, frameRate } : null
    onCamera({ devices, openDeviceId, error, retry, resolution })
  }, [onCamera, devices, openDeviceId, error, retry, width, height, frameRate])
  useEffect(() => () => onCamera(null), [onCamera])

  return (
    <section aria-label="Camera" className="flex w-min shrink-0 flex-col gap-3">
      <ScanViewport
        smooth
        videoRef={videoRef}
        error={camera.error}
        messages={CAMERA_MESSAGES}
        onRetryCamera={camera.retry}
        loop={loop}
        zoom={zoom}
        onZoom={setZoom}
        className="aspect-[3/4] h-[calc(100vh-15rem)] min-h-72 rounded-lg border-2 border-white/10"
      >
        {found && <FoundBurst key={found.key} name={found.name} price={found.price} />}
      </ScanViewport>
      {setUnreadable && <p className="text-xs text-muted-foreground">{SET_UNREADABLE}</p>}
      {setsSkipped.length > 0 && (
        <p className="text-xs text-muted-foreground">{setsSkippedText(setsSkipped)}</p>
      )}
      {loop.artReady === false && <ArtDataNotice status={loop.artData} />}
      {/* Only what's shown: the scan still reads the camera's whole picture. */}
      <ZoomSlider value={zoom} onChange={setZoom} />
      {controls}
    </section>
  )
}
