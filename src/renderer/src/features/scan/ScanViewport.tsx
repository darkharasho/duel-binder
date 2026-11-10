import { useEffect, useRef, type RefObject } from 'react'
import { SCAN_ZOOM_MAX, SCAN_ZOOM_STEP } from '@shared/scanWindow'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CardOutline } from './CardOutline'
import { PhotoButton } from './PhotoButton'
import { SmoothVideo } from './SmoothVideo'
import { statusText } from './scanText'
import type { CameraError } from './useCamera'
import type { ScanLoop } from './useScanLoop'

/**
 * The camera preview with the card outline drawn over it and the scan status along its bottom,
 * or the camera's error in its place. The caller sizes it (`className`); `children` sit over the
 * preview (the phone's flashlight button).
 *
 * `zoom` enlarges the picture on its centre, the outline with it so it stays on the card; it's
 * only what's shown, the scan still reads the whole frame. With `onZoom`, ctrl/cmd + the wheel
 * over the picture zooms it. `smooth` shows the picture through SmoothVideo, shrunk smoothly
 * rather than sampled (the desktop's 4K webcams); a phone's own camera needs no such shrink and
 * would only spend battery on it.
 */
export function ScanViewport({
  videoRef,
  error,
  messages,
  onRetryCamera,
  loop,
  className,
  zoom = 1,
  onZoom,
  smooth = false,
  status,
  children
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  error: CameraError | null
  messages: Record<CameraError, string>
  onRetryCamera: () => void
  loop: ScanLoop
  className?: string
  zoom?: number
  onZoom?: (zoom: number) => void
  smooth?: boolean
  /** Status text shown in place of the scan loop's, with no photo button (Code mode). */
  status?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const outline = loop.outline
  const boxRef = useRef<HTMLDivElement>(null)
  const zoomNow = useRef({ zoom, onZoom })
  useEffect(() => {
    zoomNow.current = { zoom, onZoom }
  })
  const zoomable = !!onZoom
  // Not React's onWheel: that listener is passive, so it couldn't stop the page zooming too.
  useEffect(() => {
    const box = boxRef.current
    if (!box || !zoomable) return
    const wheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const { zoom: z, onZoom: set } = zoomNow.current
      set?.(clampZoom(z - Math.sign(e.deltaY) * SCAN_ZOOM_STEP * 2))
    }
    box.addEventListener('wheel', wheel, { passive: false })
    return () => box.removeEventListener('wheel', wheel)
  }, [zoomable])
  return (
    <div ref={boxRef} className={cn('relative overflow-hidden bg-black', className)}>
      {error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
          <p>{messages[error]}</p>
          {error !== 'denied' && (
            <Button variant="outline" size="sm" onClick={onRetryCamera}>
              Try again
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* The picture and its outline zoom as one, so the outline stays over the card. */}
          <div
            data-testid="scan-zoom"
            className="absolute inset-0"
            style={zoom > 1 ? { transform: `scale(${zoom})` } : undefined}
          >
            {smooth ? (
              <SmoothVideo videoRef={videoRef} className="h-full w-full" />
            ) : (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover object-center"
              />
            )}
            {outline && status === undefined && (
              <CardOutline
                quad={outline.quad}
                width={outline.width}
                height={outline.height}
                locked={loop.status.kind === 'added'}
              />
            )}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/70 px-4 py-2 text-sm text-white">
            <p role="status">{status ?? statusText(loop.status)}</p>
            {status !== undefined ? null : loop.status.kind === 'stopped' ? (
              <Button variant="outline" size="xs" className="ml-auto" onClick={loop.retry}>
                Retry
              </Button>
            ) : (
              <PhotoButton status={loop.status} onClick={loop.takePhoto} className="ml-auto" />
            )}
          </div>
        </>
      )}
      {/* Buttons laid over the picture stay when the camera fails, so there's a way out. */}
      {children}
    </div>
  )
}

/** A zoom kept within 1 (none) and SCAN_ZOOM_MAX, on the slider's steps. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the zoom slider
export const clampZoom = (z: number): number =>
  Number(
    Math.min(SCAN_ZOOM_MAX, Math.max(1, Math.round(z / SCAN_ZOOM_STEP) * SCAN_ZOOM_STEP)).toFixed(2)
  )

/** The zoom slider, with how far it's zoomed; the scan window's and the in-page picture's. */
export function ZoomSlider({
  value,
  onChange,
  label = 'Zoom'
}: {
  value: number
  onChange: (zoom: number) => void
  label?: string
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm">
      Zoom
      <input
        type="range"
        aria-label={label}
        min={1}
        max={SCAN_ZOOM_MAX}
        step={SCAN_ZOOM_STEP}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 accent-primary"
      />
      <span className="w-11 text-muted-foreground tabular-nums">{value.toFixed(2)}×</span>
    </label>
  )
}
