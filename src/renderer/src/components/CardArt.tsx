import { useState } from 'react'
import { cn } from '@/lib/utils'
import { cssAspect, gameOfId } from '@shared/games'
import { useCardAspect, useCardGame } from '@/lib/game'
import { cardImageSrc, printingImageSrc } from '@/lib/images'
import { useArtLoad } from './artLoad'
import { CardPlaceholder } from './CardPlaceholder'

interface CardArtProps {
  imageId: number
  size: 'small' | 'full'
  alt: string
  className?: string
  /** Shows this printing's own scan (fetched from Yugipedia) over the default art once it loads. */
  printingId?: number | null
  /** Someone is waiting on this image (a clicked card): the desktop downloads it ahead of its queue. */
  priority?: boolean
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

/** Keyed by card, so a failed load or a shown scan never carries over to the next card. */
export function CardArt(props: CardArtProps): React.JSX.Element {
  return <CardArtImage key={props.imageId} {...props} />
}

function CardArtImage({
  imageId,
  size,
  alt,
  className,
  printingId,
  priority
}: CardArtProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const [scanShown, setScanShown] = useState<number | null>(null)
  const aspect = useCardAspect(imageId)
  const game = useCardGame(imageId)
  // Inline, not a class: the ratio is the card's game's, known only at runtime.
  const aspectStyle = { aspectRatio: cssAspect(aspect) }
  // A shimmer in the frame's shape while the art downloads, then a fade into it.
  const art = useArtLoad()
  const src = cardImageSrc(size, imageId, { now: priority })
  // No scan where there are no printing scans (the phone).
  // Nor for Pokémon: scans are Yugipedia's, Yu-Gi-Oh! only.
  const scanSrc =
    printingId == null || gameOfId(imageId) === 'pkm' ? null : printingImageSrc(printingId)
  if (printingId == null || scanSrc === null) {
    if (failed)
      return <CardPlaceholder game={game} className={className} label={alt} aspect={aspect} />
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        {...art.bind(src)}
        style={aspectStyle}
        className={cn(
          'rounded-[6px] bg-muted object-cover shadow-sm',
          art.className(src),
          className
        )}
      />
    )
  }
  const scanVisible = scanShown === printingId
  return (
    <span
      style={aspectStyle}
      className={cn(
        'relative block overflow-hidden rounded-[6px] bg-muted shadow-sm',
        !failed && !art.loaded(src) && !scanVisible && 'art-loading',
        className
      )}
    >
      {failed ? (
        <CardPlaceholder
          game={game}
          className="absolute inset-0 size-full"
          label={alt}
          aspect={aspect}
        />
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
