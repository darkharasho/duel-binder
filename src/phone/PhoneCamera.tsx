import { useRef, useState } from 'react'
import { FlashlightIcon, FlashlightOffIcon } from 'lucide-react'
import { defaultEngine, type ScanEngine } from '@/features/scan/engine'
import { useScanHub } from '@/features/scan/ScanHub'
import { ScanViewport } from '@/features/scan/ScanViewport'
import { NO_FINGERPRINTS, SET_UNREADABLE } from '@/features/scan/scanText'
import { useCamera, type CameraError } from '@/features/scan/useCamera'
import { useHubScan } from '@/features/scan/useHubScan'
import { cn } from '@/lib/utils'

const CAMERA_MESSAGES: Record<CameraError, string> = {
  denied: 'Duel Binder needs the camera to scan. Allow it for this site in your browser settings.',
  none: "This phone's camera didn't open.",
  lost: 'The camera stopped.'
}

/** The video track's torch, where the browser offers one (Chrome on Android; not iPhone). */
function useTorch(stream: MediaStream | null): {
  available: boolean
  on: boolean
  toggle: () => void
} {
  const track = stream?.getVideoTracks()[0]
  const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean }
  const available = caps.torch === true
  // Kept with the stream it was set on: a new stream starts with its light off.
  const [lit, setLit] = useState<{ stream: MediaStream | null; on: boolean }>({
    stream: null,
    on: false
  })
  const on = lit.stream === stream && lit.on
  const toggle = (): void => {
    if (!track) return
    const next = !on
    setLit({ stream, on: next })
    track
      .applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .catch(() => setLit({ stream, on: !next }))
  }
  return { available, on, toggle }
}

/**
 * The phone's camera: the rear camera with the card outline and the scan status over it, as the
 * desktop's in-page scanner. It takes the room the rows below it leave: at the screen's width
 * where that fits, else narrower, always 3:4 (the scanned crop is what the preview shows).
 * `children` sit on the preview. Pulls are counted through the hub.
 */
export function PhoneCamera({
  engineFactory = defaultEngine,
  className,
  children
}: {
  engineFactory?: () => ScanEngine
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const { settings } = useScanHub()
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(settings.deviceId, 'environment')
  const { loop, setUnreadable } = useHubScan({ videoRef, stream: camera.stream, engineFactory })
  const torch = useTorch(camera.stream)

  return (
    <section aria-label="Camera" className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {/* A size container, so the preview can be the largest 3:4 box that fits it. */}
      <div data-camera-stage className="flex min-h-0 flex-1 justify-center [container-type:size]">
        <ScanViewport
          videoRef={videoRef}
          error={camera.error}
          messages={CAMERA_MESSAGES}
          onRetryCamera={camera.retry}
          loop={loop}
          className="aspect-[3/4] w-[min(100cqw,75cqh)] rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
        >
          {children}
          {torch.available && (
            <button
              type="button"
              aria-label="Flashlight"
              aria-pressed={torch.on}
              onClick={torch.toggle}
              className={cn(
                'absolute right-2 top-2 flex size-11 items-center justify-center rounded-full backdrop-blur-md transition-colors',
                torch.on ? 'bg-amber-300 text-black' : 'bg-black/45 text-white'
              )}
            >
              {torch.on ? (
                <FlashlightIcon aria-hidden className="size-5" />
              ) : (
                <FlashlightOffIcon aria-hidden className="size-5" />
              )}
            </button>
          )}
        </ScanViewport>
      </div>
      {setUnreadable && (
        <p className="shrink-0 px-4 pt-2 text-xs text-muted-foreground">{SET_UNREADABLE}</p>
      )}
      {loop.artReady === false && (
        <p className="shrink-0 px-4 pt-2 text-xs text-muted-foreground">{NO_FINGERPRINTS}</p>
      )}
    </section>
  )
}
