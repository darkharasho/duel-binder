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
 * The phone's camera: the rear camera at the screen's width (3:4), with the card outline and the
 * scan status over it, as the desktop's in-page scanner. Pulls are counted through the hub.
 */
export function PhoneCamera({
  engineFactory = defaultEngine,
  className
}: {
  engineFactory?: () => ScanEngine
  className?: string
}): React.JSX.Element {
  const { settings } = useScanHub()
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(settings.deviceId, 'environment')
  const { loop, setUnreadable } = useHubScan({ videoRef, stream: camera.stream, engineFactory })
  const torch = useTorch(camera.stream)

  return (
    <section aria-label="Camera" className={cn('flex flex-col', className)}>
      <ScanViewport
        videoRef={videoRef}
        error={camera.error}
        messages={CAMERA_MESSAGES}
        onRetryCamera={camera.retry}
        loop={loop}
        className="aspect-[3/4] w-full"
      >
        {torch.available && (
          <button
            type="button"
            aria-label="Flashlight"
            aria-pressed={torch.on}
            onClick={torch.toggle}
            className={cn(
              'absolute right-3 top-3 flex size-11 items-center justify-center rounded-full backdrop-blur-md transition-colors',
              torch.on ? 'bg-amber-300 text-black' : 'bg-black/50 text-white'
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
      {setUnreadable && <p className="px-4 pt-2 text-xs text-muted-foreground">{SET_UNREADABLE}</p>}
      {loop.artReady === false && (
        <p className="px-4 pt-2 text-xs text-muted-foreground">{NO_FINGERPRINTS}</p>
      )}
    </section>
  )
}
