import { useState } from 'react'
import { cn } from '@/lib/utils'
import { cssAspect, gameOfId } from '@shared/games'
import { useCardAspect, useCardGame } from '@/lib/game'
import { useBorrowedArt, type BorrowedArt } from '@/lib/borrowedArt'
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

/**
 * What a borrowed picture is labelled. `wide` is the tile the words fit under; both are written out
 * for Tailwind to find.
 */
const ART_LABELS: Record<
  BorrowedArt['language'],
  { words: string; letters: string; wide: { words: string; letters: string } }
> = {
  en: {
    words: 'English art',
    letters: 'EN',
    wide: { words: '@[5rem]:block', letters: '@[5rem]:hidden' }
  },
  'zh-hant': {
    words: 'Traditional Chinese art',
    letters: 'TC',
    wide: { words: '@[9rem]:block', letters: '@[9rem]:hidden' }
  }
}

/** Says the art is another printing's. Under a tile wide enough for the words, the two letters. */
function BorrowedArtLabel({ language }: { language: BorrowedArt['language'] }): React.JSX.Element {
  const label = ART_LABELS[language]
  return (
    <span
      data-testid="borrowed-art-label"
      className="pointer-events-none absolute bottom-[3%] left-[4%] max-w-[92%] rounded-[3px] bg-black/70 font-medium leading-none text-white"
    >
      <span
        className={cn(
          'hidden whitespace-nowrap px-1 py-0.5 text-[9px] @[12rem]:px-1.5 @[12rem]:py-1 @[12rem]:text-xs',
          label.wide.words
        )}
      >
        {label.words}
      </span>
      <span aria-hidden className={cn('block px-0.5 py-px text-[7px]', label.wide.letters)}>
        {label.letters}
      </span>
    </span>
  )
}

/**
 * Keyed by card, so a failed load or a shown scan never carries over to the next card. A card that
 * borrows art shows the other card's image by that image's own id, so the two share one download
 * and art of its own replaces it at once.
 */
export function CardArt(props: CardArtProps): React.JSX.Element {
  const { imageId, alt, className } = props
  const borrowed = useBorrowedArt(imageId)
  const aspect = useCardAspect(imageId)
  if (borrowed === undefined)
    return (
      <span
        role="img"
        aria-label={alt}
        style={{ aspectRatio: cssAspect(aspect) }}
        className={cn('art-loading block rounded-[6px] bg-muted shadow-sm', className)}
      />
    )
  if (borrowed === null) return <CardArtImage key={imageId} {...props} />
  const { words } = ART_LABELS[borrowed.language]
  return (
    <span
      title={words}
      className={cn('@container relative block rounded-[6px] shadow-sm', className)}
    >
      <CardArtImage
        key={borrowed.imageId}
        {...props}
        imageId={borrowed.imageId}
        alt={alt && `${alt} (${words})`}
        className="block w-full rounded-[inherit] shadow-none"
      />
      <BorrowedArtLabel language={borrowed.language} />
    </span>
  )
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
