import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { cssAspect, gameOfId } from '@shared/games'
import { useCardAspect, useCardGame } from '@/lib/game'
import { useBorrowedArt, type BorrowedArt } from '@/lib/borrowedArt'
import { cardImageSrc } from '@/lib/images'
import { usePrintingPhotoSrc } from '@/lib/printingPhotos'
import { artLoadedOnce, markArtLoaded, useArtLoad } from './artLoad'
import { CardPlaceholder } from './CardPlaceholder'
import { ReverseLayer } from './ReverseLayer'
import { coverFit, type ReverseLook } from '@shared/reverseHolo'

interface CardArtProps {
  imageId: number
  size: 'small' | 'full'
  alt: string
  className?: string
  /** Shows this printing's own scan (fetched from Yugipedia) over the default art once it loads. */
  printingId?: number | null
  /** Someone is waiting on this image (a clicked card): the desktop downloads it ahead of its queue. */
  priority?: boolean
  /** A Pokémon Reverse Holofoil printing's look (`reverseLook`), drawn over the art. */
  reverse?: ReverseLook | null
}

/**
 * The printing's scan, faded in over the default art; removed if the printing has none. One that
 * has loaded before this session shows at once, with no fade (a page switch remounts every tile).
 */
function PrintingScan({
  src,
  onLoaded
}: {
  src: string
  onLoaded: (loaded: boolean) => void
}): React.JSX.Element | null {
  const [known] = useState(() => artLoadedOnce(src))
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(known ? 'loaded' : 'loading')
  if (state === 'failed') return null
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      data-testid="printing-scan"
      loading={known ? 'eager' : 'lazy'}
      draggable={false}
      onLoad={() => {
        markArtLoaded(src)
        setState('loaded')
        onLoaded(true)
      }}
      onError={() => {
        setState('failed')
        onLoaded(false)
      }}
      className={cn(
        'absolute inset-0 size-full object-cover',
        !known && 'transition-opacity duration-300',
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
  ja: {
    words: 'Japanese art',
    letters: 'JP',
    wide: { words: '@[6rem]:block', letters: '@[6rem]:hidden' }
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
  const { reverse } = props
  if (!reverse || gameOfId(props.imageId) !== 'pkm') return <CardArtFace {...props} />
  return <ReverseCardArt {...props} reverse={reverse} />
}

/**
 * The art with its reverse look on top. The image fills its frame cropped (`object-cover`), and
 * art whose shape differs from the frame's (Delta Reign's, 733 × 1024 in a 600 × 825 frame) loses
 * a strip off two edges, so the look is cropped the same way: its regions are the image's.
 */
function ReverseCardArt(props: CardArtProps & { reverse: ReverseLook }): React.JSX.Element {
  const { reverse, className, imageId } = props
  const box = useRef<HTMLSpanElement>(null)
  const frame = useCardAspect(imageId)
  const [image, setImage] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const read = (img: HTMLImageElement | null): void => {
      if (img?.naturalWidth && img.naturalHeight) setImage(img.naturalWidth / img.naturalHeight)
    }
    const img = el.querySelector('img')
    if (img?.complete) read(img)
    // A load doesn't bubble, but it does pass its ancestors on the way down: catch every image's.
    const onLoad = (e: Event): void => {
      if (e.target instanceof HTMLImageElement) read(e.target)
    }
    el.addEventListener('load', onLoad, true)
    return () => el.removeEventListener('load', onLoad, true)
  }, [])
  return (
    <span ref={box} className={cn('relative isolate block rounded-[6px] shadow-sm', className)}>
      <CardArtFace {...props} className="block w-full rounded-[inherit] shadow-none" />
      <ReverseLayer look={reverse} fit={coverFit(frame.width / frame.height, image)} />
    </span>
  )
}

function CardArtFace(props: CardArtProps): React.JSX.Element {
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
  const aspect = useCardAspect(imageId)
  const game = useCardGame(imageId)
  // Inline, not a class: the ratio is the card's game's, known only at runtime.
  const aspectStyle = { aspectRatio: cssAspect(aspect) }
  // A shimmer in the frame's shape while the art downloads, then a fade into it.
  const art = useArtLoad()
  const src = cardImageSrc(size, imageId, { now: priority })
  // A clicked card's full art shows the small one the grid already has until it arrives, in place
  // of the shimmer, and loads at once rather than lazily.
  const preview = priority && size === 'full' ? cardImageSrc('small', imageId) : null
  const previewStyle = preview
    ? {
        backgroundImage: `url("${preview}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }
    : undefined
  const loading = art.loading(src, priority ? 'eager' : 'lazy')
  // No scan for Pokémon: scans are Yugipedia's, Yu-Gi-Oh! only. On the phone, none until the
  // printing's server id is known.
  // 'op' has no printing photos either.
  const photo = usePrintingPhotoSrc(gameOfId(imageId) === 'ygo' ? (printingId ?? null) : null, {
    small: size !== 'full'
  })
  const scanSrc = printingId == null ? null : photo
  // A scan seen before this session covers the default art from the first frame.
  const [scanShown, setScanShown] = useState<number | null>(() =>
    printingId != null && scanSrc !== null && artLoadedOnce(scanSrc) ? printingId : null
  )
  if (printingId == null || scanSrc === null) {
    if (failed)
      return <CardPlaceholder game={game} className={className} label={alt} aspect={aspect} />
    return (
      <img
        src={src}
        alt={alt}
        loading={loading}
        draggable={false}
        onError={() => setFailed(true)}
        {...art.bind(src)}
        style={preview && !art.loaded(src) ? { ...aspectStyle, ...previewStyle } : aspectStyle}
        className={cn(
          'rounded-[6px] bg-muted object-cover shadow-sm',
          // The preview stands in for the shimmer, and the full art replaces it without a fade.
          !preview && art.className(src),
          className
        )}
      />
    )
  }
  const scanVisible = scanShown === printingId
  return (
    <span
      style={
        preview && !failed && !art.loaded(src) && !scanVisible
          ? { ...aspectStyle, ...previewStyle }
          : aspectStyle
      }
      className={cn(
        'relative block overflow-hidden rounded-[6px] bg-muted shadow-sm',
        !preview && !failed && !art.loaded(src) && !scanVisible && 'art-loading',
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
          loading={loading}
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
