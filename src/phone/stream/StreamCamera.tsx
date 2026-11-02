import { useCallback, useEffect, useRef, useState } from 'react'
import { LOOK_MODEL } from '@shared/scan/lookModel'
import { scanProfile } from '@shared/scan/profiles'
import { Button } from '@/components/ui/button'
import { ArtDataNotice } from '@/features/scan/ArtDataNotice'
import type { CropRect } from '@/features/scan/crop'
import { defaultEngine, type EngineFactory } from '@/features/scan/engine'
import type { ScanDraft } from '@/features/scan/resolve'
import { useScanHub } from '@/features/scan/ScanHub'
import { statusText } from '@/features/scan/scanText'
import type { ScanRow } from '@/features/scan/session'
import { useCamera } from '@/features/scan/useCamera'
import { useHubScan } from '@/features/scan/useHubScan'
import type { Pull } from '@/features/scan/window/overlay'
import { PullOverlay } from '@/features/scan/window/PullOverlay'
import { useOverlay } from '@/features/scan/window/useOverlay'
import { useGame } from '@/lib/game'
import { cn } from '@/lib/utils'
import { CAMERA_MESSAGES } from '../copy'
import { scanArea } from './scanArea'

const NO_SIZE = { width: 0, height: 0 }
const CORNER = 'absolute size-7 border-white/45'

/** Faint corners around the part of the picture the scanner reads (see scanArea). */
function ScanAreaMarks({ area }: { area: CropRect }): React.JSX.Element {
  return (
    <div
      data-testid="scan-area"
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: area.x, top: area.y, width: area.width, height: area.height }}
    >
      <span className={cn(CORNER, 'left-0 top-0 rounded-tl-xl border-l-2 border-t-2')} />
      <span className={cn(CORNER, 'right-0 top-0 rounded-tr-xl border-r-2 border-t-2')} />
      <span className={cn(CORNER, 'bottom-0 left-0 rounded-bl-xl border-b-2 border-l-2')} />
      <span className={cn(CORNER, 'bottom-0 right-0 rounded-br-xl border-b-2 border-r-2')} />
    </div>
  )
}

/** Why the picture or the scanning stopped, over the camera, with the way to start it again. */
function Stopped({
  message,
  action,
  onAction
}: {
  message: string
  action: string | null
  onAction: () => void
}): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black p-8 text-center text-sm text-white/70">
      <p>{message}</p>
      {action && (
        <Button variant="outline" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  )
}

/**
 * A stream's camera: the rear camera edge to edge, unmirrored, with corner marks on the area the
 * scanner reads, and each pull's card or hit moment over it as on the desktop's stream window.
 * There is no status line or photo button: viewers see the picture and the pulls. `children` sit
 * above the picture and below the pop-ups, and give way to a hit. Each pull reaches `onPull` as
 * the row the list just took. Paused, it scans nothing and shows only the picture.
 */
export function StreamCamera({
  engineFactory = defaultEngine,
  paused,
  onPull,
  children
}: {
  engineFactory?: EngineFactory
  paused: boolean
  onPull: (row: ScanRow) => void
  children?: React.ReactNode
}): React.JSX.Element {
  const { settings } = useScanHub()
  const { game } = useGame()
  const viewRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(settings.deviceId, 'environment')
  const { overlay, push, clear } = useOverlay()
  // Copies on the list by pull id, for the pop-up's owned line.
  const [scanned, setScanned] = useState<Readonly<Record<string, number>>>({})

  const pulled = useCallback(
    (pull: Pull, copies: number, draft: ScanDraft): void => {
      push({ ...pull })
      const key = pull.id
      if (key === undefined) return
      setScanned((s) => ({ ...s, [key]: copies }))
      onPull({ ...draft, key, quantity: 1, addedAt: Date.now() })
    },
    [push, onPull]
  )
  const { loop } = useHubScan({
    videoRef,
    stream: camera.stream,
    engineFactory,
    // The phone scanner's recognition as it is, look model and all (see PhoneCamera).
    lookModel: scanProfile(game).rarityLook ? LOOK_MODEL : null,
    onStalled: camera.retry,
    paused,
    onPull: pulled
  })

  useEffect(() => {
    if (paused) clear()
  }, [paused, clear])

  // The video's own size and the screen's, for where the marks go; both change on a rotation.
  const [size, setSize] = useState({ video: NO_SIZE, view: NO_SIZE })
  useEffect(() => {
    const view = viewRef.current
    const video = videoRef.current
    if (!view || !video) return
    const measure = (): void =>
      setSize({
        video: { width: video.videoWidth, height: video.videoHeight },
        view: { width: view.clientWidth, height: view.clientHeight }
      })
    const observer = new ResizeObserver(measure)
    observer.observe(view)
    video.addEventListener('resize', measure)
    video.addEventListener('loadedmetadata', measure)
    return () => {
      observer.disconnect()
      video.removeEventListener('resize', measure)
      video.removeEventListener('loadedmetadata', measure)
    }
  }, [])

  const stopped = loop.status.kind === 'stopped'
  return (
    <div ref={viewRef} className="absolute inset-0 overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 size-full object-cover"
      />
      {!paused && !camera.error && size.view.width > 0 && (
        <ScanAreaMarks area={scanArea(size.video, size.view)} />
      )}
      {camera.error ? (
        <Stopped
          message={CAMERA_MESSAGES[camera.error]}
          action={camera.error === 'denied' ? null : 'Try again'}
          onAction={camera.retry}
        />
      ) : (
        stopped && (
          <Stopped message={statusText(loop.status)} action="Retry" onAction={loop.retry} />
        )
      )}
      {/* A hit's moment fills the top, so the count and controls make way until it's over. */}
      {!overlay?.hit && children}
      {loop.artReady === false && (
        <div className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-2xl bg-black/55 p-2 backdrop-blur-md landscape:right-auto landscape:left-[max(0.75rem,env(safe-area-inset-left))] landscape:max-w-[55vw]">
          <ArtDataNotice status={loop.artData} />
        </div>
      )}
      <PullOverlay pull={overlay} scanned={scanned} phone />
    </div>
  )
}
