import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CardOutline } from './CardOutline'
import { PhotoButton } from './PhotoButton'
import { statusText } from './scanText'
import type { CameraError } from './useCamera'
import type { ScanLoop } from './useScanLoop'

/**
 * The camera preview with the card outline drawn over it and the scan status along its bottom,
 * or the camera's error in its place. The caller sizes it (`className`); `children` sit over the
 * preview (the phone's flashlight button).
 */
export function ScanViewport({
  videoRef,
  error,
  messages,
  onRetryCamera,
  loop,
  className,
  children
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  error: CameraError | null
  messages: Record<CameraError, string>
  onRetryCamera: () => void
  loop: ScanLoop
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const outline = loop.outline
  return (
    <div className={cn('relative overflow-hidden bg-black', className)}>
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
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover object-center"
          />
          {outline && (
            <CardOutline
              quad={outline.quad}
              width={outline.width}
              height={outline.height}
              locked={loop.status.kind === 'added'}
            />
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/70 px-4 py-2 text-sm text-white">
            <p role="status">{statusText(loop.status)}</p>
            {loop.status.kind === 'stopped' ? (
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
