import { useState } from 'react'
import { cn } from '@/lib/utils'
import { cssAspect, type CardAspect } from '@shared/games'
import { useCardAspect } from '@/lib/game'
import { cardImageSrc, printingImageSrc } from '@/lib/images'

interface CardArtProps {
  imageId: number
  size: 'small' | 'full'
  alt: string
  className?: string
  /** Shows this printing's own scan (fetched from Yugipedia) over the default art once it loads. */
  printingId?: number | null
}

function CardBack({
  className,
  label,
  aspect
}: {
  className?: string
  label: string
  aspect: CardAspect
}): React.JSX.Element {
  const { width: w, height: h } = aspect
  // Drawn on Yu-Gi-Oh!'s 421×614 card, scaled to the game's: a 24-unit border, an oval in the middle.
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="card-art-placeholder"
      viewBox={`0 0 ${w} ${h}`}
      style={{ aspectRatio: cssAspect(aspect) }}
      className={cn('rounded-[6px] shadow-sm', className)}
    >
      <rect width={w} height={h} fill="currentColor" className="text-zinc-300 dark:text-zinc-700" />
      <rect
        x="24"
        y="24"
        width={w - 48}
        height={h - 48}
        rx="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        className="text-zinc-400 dark:text-zinc-500"
      />
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={(92 * w) / 421}
        ry={(132 * h) / 614}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        className="text-zinc-400 dark:text-zinc-500"
      />
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

export function CardArt({
  imageId,
  size,
  alt,
  className,
  printingId
}: CardArtProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const [scanShown, setScanShown] = useState<number | null>(null)
  const aspect = useCardAspect(imageId)
  // Inline, not a class: the ratio is the card's game's, known only at runtime.
  const aspectStyle = { aspectRatio: cssAspect(aspect) }
  // No scan where there are no printing scans (the phone).
  const scanSrc = printingId == null ? null : printingImageSrc(printingId)
  if (printingId == null || scanSrc === null) {
    if (failed) return <CardBack className={className} label={alt} aspect={aspect} />
    return (
      <img
        src={cardImageSrc(size, imageId)}
        alt={alt}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        style={aspectStyle}
        className={cn('rounded-[6px] bg-muted object-cover shadow-sm', className)}
      />
    )
  }
  const scanVisible = scanShown === printingId
  return (
    <span
      style={aspectStyle}
      className={cn('relative block overflow-hidden rounded-[6px] bg-muted shadow-sm', className)}
    >
      {failed ? (
        <CardBack className="absolute inset-0 size-full" label={alt} aspect={aspect} />
      ) : (
        <img
          src={cardImageSrc(size, imageId)}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          // Hidden under a loaded scan so its corners don't show through transparent ones.
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-300',
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
