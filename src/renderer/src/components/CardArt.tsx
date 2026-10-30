import { useState } from 'react'
import { cn } from '@/lib/utils'
import { cardImageSrc, printingImageSrc } from '@/lib/images'
import { useArtLoad } from './artLoad'

interface CardArtProps {
  imageId: number
  size: 'small' | 'full'
  alt: string
  className?: string
  /** Shows this printing's own scan (fetched from Yugipedia) over the default art once it loads. */
  printingId?: number | null
}

function CardBack({ className, label }: { className?: string; label: string }): React.JSX.Element {
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="card-art-placeholder"
      viewBox="0 0 421 614"
      className={cn('aspect-[421/614] rounded-[6px] shadow-sm', className)}
    >
      <rect width="421" height="614" fill="currentColor" className="text-zinc-300 dark:text-zinc-700" />
      <rect x="24" y="24" width="373" height="566" rx="8" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-400 dark:text-zinc-500" />
      <ellipse cx="210.5" cy="307" rx="92" ry="132" fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-400 dark:text-zinc-500" />
    </svg>
  )
}

/** The printing's scan, faded in over the default art; removed if the printing has none. */
function PrintingScan({
  src,
  onLoaded
}: {
  src: string
  onLoaded: (loaded: boolean) => void
}): React.JSX.Element | null {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  if (state === 'failed') return null
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      data-testid="printing-scan"
      loading="lazy"
      draggable={false}
      onLoad={() => {
        setState('loaded')
        onLoaded(true)
      }}
      onError={() => {
        setState('failed')
        onLoaded(false)
      }}
      className={cn(
        'absolute inset-0 size-full object-cover transition-opacity duration-300',
        state === 'loaded' ? 'opacity-100' : 'opacity-0'
      )}
    />
  )
}

export function CardArt({ imageId, size, alt, className, printingId }: CardArtProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const [scanShown, setScanShown] = useState<number | null>(null)
  // A shimmer in the frame's shape while the art downloads, then a fade into it.
  const art = useArtLoad()
  const src = cardImageSrc(size, imageId)
  // No scan where there are no printing scans (the phone).
  const scanSrc = printingId == null ? null : printingImageSrc(printingId)
  if (printingId == null || scanSrc === null) {
    if (failed) return <CardBack className={className} label={alt} />
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        {...art.bind(src)}
        className={cn(
          'aspect-[421/614] rounded-[6px] bg-muted object-cover shadow-sm',
          art.className(src),
          className
        )}
      />
    )
  }
  const scanVisible = scanShown === printingId
  return (
    <span
      className={cn(
        'relative block aspect-[421/614] overflow-hidden rounded-[6px] bg-muted shadow-sm',
        !failed && !art.loaded(src) && !scanVisible && 'art-loading',
        className
      )}
    >
      {failed ? (
        <CardBack className="absolute inset-0 size-full" label={alt} />
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          {...art.bind(src)}
          // Hidden under a loaded scan so its corners don't show through transparent ones.
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-300',
            art.loaded(src) && !scanVisible && art.className(src),
            scanVisible && 'opacity-0'
          )}
        />
      )}
      <PrintingScan
        key={printingId}
        src={scanSrc}
        onLoaded={(loaded) => setScanShown(loaded ? printingId : null)}
      />
    </span>
  )
}
