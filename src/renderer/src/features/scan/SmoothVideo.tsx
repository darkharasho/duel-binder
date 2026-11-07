import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { cn } from '@/lib/utils'

export type VideoFit = 'cover' | 'contain'

/**
 * The size to draw a videoWidth x videoHeight frame at so that, laid out with object-fit `fit` in
 * a box shown at boxWidth x boxHeight device pixels, each drawn pixel lands on about one screen
 * pixel: never more than the frame itself has.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a pure helper, tested on its own
export function drawSize(
  videoWidth: number,
  videoHeight: number,
  boxWidth: number,
  boxHeight: number,
  fit: VideoFit
): { width: number; height: number } {
  const across = boxWidth / videoWidth
  const down = boxHeight / videoHeight
  const scale = Math.min(1, fit === 'cover' ? Math.max(across, down) : Math.min(across, down))
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale))
  }
}

/**
 * The camera's <video>, shown through a canvas it is drawn into with a smooth shrink. Chromium
 * shrinks a <video> on screen by sampling it, so a 4K camera in a 1080p window (three pixels in
 * four dropped) makes foil and small print sparkle and look grainy, though the picture is sharp;
 * the canvas is drawn at the size it is shown at (drawSize, zoom included, as it is measured on
 * screen) with imageSmoothingQuality 'high', which averages instead. The video stays underneath,
 * playing at full size for the scan loop to read (videoRef); it shows until the first frame is
 * drawn, and in place of the canvas wherever there's no 2D canvas to draw into.
 */
export function SmoothVideo({
  videoRef,
  fit = 'cover',
  className,
  style
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  fit?: VideoFit
  className?: string
  style?: CSSProperties
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false }) ?? null
    if (!canvas || !ctx) return
    let frame = 0
    let lastTime = -1
    let shown = false
    const draw = (): void => {
      frame = requestAnimationFrame(draw)
      const video = videoRef.current
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
      const box = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const size = drawSize(
        video.videoWidth,
        video.videoHeight,
        box.width * dpr,
        box.height * dpr,
        fit
      )
      const resized = canvas.width !== size.width || canvas.height !== size.height
      if (resized) {
        canvas.width = size.width
        canvas.height = size.height
      }
      // A live stream's time moves on with each new frame: an unchanged one has been drawn.
      if (!resized && video.currentTime === lastTime) return
      lastTime = video.currentTime
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(video, 0, 0, size.width, size.height)
      if (!shown) {
        shown = true
        setDrawn(true)
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [videoRef, fit])

  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover'
  return (
    <div className={cn('relative', className)} style={style}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn('absolute inset-0 h-full w-full object-center', fitClass)}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        data-testid="smooth-video"
        className={cn(
          'absolute inset-0 h-full w-full object-center',
          fitClass,
          !drawn && 'invisible'
        )}
      />
    </div>
  )
}
