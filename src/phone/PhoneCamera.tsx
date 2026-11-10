import { useEffect, useRef, useState } from 'react'
import { FlashlightIcon, FlashlightOffIcon } from 'lucide-react'
import type { LookModel } from '@shared/scan/look'
import { LOOK_MODEL } from '@shared/scan/lookModel'
import type { TiltModel } from '@shared/scan/tilt'
import { TILT_MODELS } from '@shared/scan/tiltModel'
import type { GameId } from '@shared/games/types'
import { scanProfile } from '@shared/scan/profiles'
import { defaultEngine, type EngineFactory } from '@/features/scan/engine'
import { useScanHub } from '@/features/scan/ScanHub'
import { ArtDataNotice } from '@/features/scan/ArtDataNotice'
import { ScanViewport } from '@/features/scan/ScanViewport'
import { useCamera } from '@/features/scan/useCamera'
import { useHubScan } from '@/features/scan/useHubScan'
import { CODE_AIM } from '@/features/scan/codeMode'
import { codeStatusText } from '@/features/scan/useCodeReader'
import { useGame } from '@/lib/game'
import { cn } from '@/lib/utils'
import { CAMERA_MESSAGES } from './copy'
import { ScanTimingsReadout } from './ScanTimings'
import { scanTimingsOn } from './scanTimingsSetting'

/**
 * The widest live frame the phone scans (useScanLoop's maxFrameWidth): its 4K camera's crop is
 * 2160 wide, which took the phone ~3x the desktop's time a frame. Above the 810-wide frames the
 * scan photo tests read.
 */
const LIVE_FRAME_WIDTH = 1080

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
  // A new element after coming back from another app, as the preview takes (ScanViewport).
  const [shows, setShows] = useState(0)
  useEffect(() => {
    const shown = (): void => {
      if (document.visibilityState === 'visible') setShows((n) => n + 1)
    }
    document.addEventListener('visibilitychange', shown)
    return () => document.removeEventListener('visibilitychange', shown)
  }, [])
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play?.()?.catch(() => undefined)
  }, [stream, shows])
  if (!stream) return null
  return (
    <video
      key={shows}
      ref={ref}
      aria-hidden
      autoPlay
      muted
      playsInline
      className="pointer-events-none absolute inset-0 -z-10 size-full scale-125 object-cover blur-2xl brightness-[0.45] saturate-150"
    />
  )
}

/** Code mode's aim box (CODE_AIM), with the picture around it dimmed. */
function AimBox({ added }: { added: boolean }): React.JSX.Element {
  const [x0, y0, x1, y1] = CODE_AIM
  return (
    <div
      data-testid="code-aim"
      aria-hidden
      className={cn(
        'pointer-events-none absolute rounded-xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-colors',
        added ? 'border-emerald-400' : 'border-white/90'
      )}
      style={{
        left: `${x0 * 100}%`,
        top: `${y0 * 100}%`,
        width: `${(x1 - x0) * 100}%`,
        height: `${(y1 - y0) * 100}%`
      }}
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
 * without them (Pokémon) scans without it. `lookModel` and `tiltModels` are for tests.
 */
export function PhoneCamera({
  engineFactory = defaultEngine,
  lookModel = LOOK_MODEL,
  tiltModels = TILT_MODELS,
  className,
  codeMode = false,
  children
}: {
  engineFactory?: EngineFactory
  /** Read only set codes in an aim box (Code mode), not whole cards. */
  codeMode?: boolean
  lookModel?: LookModel | null
  tiltModels?: Partial<Record<GameId, TiltModel>> | null
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const { settings } = useScanHub()
  const { game } = useGame()
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useCamera(settings.deviceId, 'environment')
  // Read once a mount: Settings and the scanner are never on screen together.
  const [timings] = useState(scanTimingsOn)
  const { loop, codeStatus } = useHubScan({
    videoRef,
    stream: camera.stream,
    engineFactory,
    lookModel: scanProfile(game).rarityLook ? lookModel : null,
    tiltModels,
    onStalled: camera.retry,
    codeMode,
    timings,
    maxFrameWidth: LIVE_FRAME_WIDTH
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
          status={codeMode ? codeStatusText(codeStatus) : undefined}
          videoKey={codeMode ? 'code' : 'card'}
          freshVideo
          className="aspect-[3/4] w-[min(100cqw,75cqh)] rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
        >
          {codeMode && <AimBox added={codeStatus.kind === 'added'} />}
          {timings && !codeMode && <ScanTimingsReadout timing={loop.timing} />}
          {children}
          {!codeMode && loop.artReady === false && (
            <div className="absolute inset-x-2 bottom-2 rounded-2xl bg-black/55 p-2 backdrop-blur-md">
              <ArtDataNotice status={loop.artData} />
            </div>
          )}
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
