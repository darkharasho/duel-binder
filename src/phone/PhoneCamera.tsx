import { useEffect, useRef, useState } from 'react'
import { FlashlightIcon, FlashlightOffIcon } from 'lucide-react'
import type { LookModel } from '@shared/scan/look'
import { LOOK_MODEL } from '@shared/scan/lookModel'
import { scanProfile } from '@shared/scan/profiles'
import { defaultEngine, type EngineFactory } from '@/features/scan/engine'
import { useScanHub } from '@/features/scan/ScanHub'
import { ScanViewport } from '@/features/scan/ScanViewport'
import { useCamera, type CameraError } from '@/features/scan/useCamera'
import { useHubScan } from '@/features/scan/useHubScan'
import { useGame } from '@/lib/game'
import { cn } from '@/lib/utils'

const CAMERA_MESSAGES: Record<CameraError, string> = {
  denied: 'Duel Binder needs the camera to scan. Allow it for this site in your browser settings.',
  none: "This phone's camera didn't open.",
  lost: 'The camera stopped.',
  busy: 'The camera is in use by another app.'
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
 * The camera's own picture, blurred and dimmed, filling the screen behind everything (as DexTCG
 * does); it needs a positioned, isolated ancestor.
 */
function CameraBackdrop({ stream }: { stream: MediaStream | null }): React.JSX.Element | null {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play?.()?.catch(() => undefined)
  }, [stream])
  if (!stream) return null
  return (
    <video
      ref={ref}
      aria-hidden
      autoPlay
      muted
      playsInline
      className="pointer-events-none absolute inset-0 -z-10 size-full scale-125 object-cover blur-2xl brightness-[0.45] saturate-150"
    />
  )
}

/**
 * The phone's camera: the rear camera with the card outline and the scan status over it, as the
 * desktop's in-page scanner. It takes the room the rows below it leave: at the screen's width
 * where that fits, else narrower, always 3:4 (the scanned crop is what the preview shows).
 * `children` sit on the preview; the flashlight, where there is one, sits left of a top-right
 * child. Behind it all, the camera's picture blurred. Pulls are counted through the hub.
 *
 * Unlike the desktop's scanners, it reads rarity with the look model after the name and frame
 * rules (useScanLoop's lookModel): it was fitted and tested on photos the size of a phone
 * camera's, and gains nothing on a desktop webcam. It reads Yu-Gi-Oh! rarities only, so a game
 * without them (Pokémon) scans without it. `lookModel` is for tests.
 */
export function PhoneCamera({
  engineFactory = defaultEngine,
  lookModel = LOOK_MODEL,
  className,
  children
}: {
  engineFactory?: EngineFactory
  lookModel?: LookModel | null
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const { settings } = useScanHub()
  const { game } = useGame()
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(settings.deviceId, 'environment')
  const { loop } = useHubScan({
    videoRef,
    stream: camera.stream,
    engineFactory,
    lookModel: scanProfile(game).rarityLook ? lookModel : null,
    onStalled: camera.retry
  })
  const torch = useTorch(camera.stream)

  return (
    <section aria-label="Camera" className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <CameraBackdrop stream={camera.error ? null : camera.stream} />
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
                'absolute right-14 top-2 flex size-11 items-center justify-center rounded-full backdrop-blur-md transition-colors',
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
    </section>
  )
}
