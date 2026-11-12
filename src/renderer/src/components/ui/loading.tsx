import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Loading pieces every page shares, so a page that waits on its data shows that it's waiting
 * rather than a blank, a "0" or an empty-state message. The shapes use the art shimmer
 * (`.art-loading` in index.css), the spinner the sync banner's.
 */

/** A small spinning ring, for inline use. Decorative: pair it with text or a labelled container. */
export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <Loader2
      aria-hidden
      className={cn('size-3.5 shrink-0 animate-spin text-muted-foreground', className)}
    />
  )
}

/** "Loading…" with a spinner, announced to screen readers. For a short line or a filter section. */
export function InlineLoading({
  label = 'Loading…',
  className
}: {
  label?: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}
    >
      <Spinner />
      {label}
    </span>
  )
}

/** A centred spinner and label in place of a whole section or page body. */
export function LoadingState({
  label = 'Loading…',
  className
}: {
  label?: string
  className?: string
}): React.JSX.Element {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground',
        className
      )}
    >
      <Spinner className="size-4" />
      {label}
    </div>
  )
}

/** A shimmering block in a content's place. */
export function Skeleton({
  className,
  style
}: {
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  return <div aria-hidden style={style} className={cn('art-loading rounded-[4px]', className)} />
}

/** A card tile's shape: the art (a Yu-Gi-Oh!-sized card) and two lines of text. */
function TileSkeleton(): React.JSX.Element {
  return (
    <div className="p-1">
      <Skeleton className="mb-2 w-full" style={{ aspectRatio: '59 / 86' }} />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="mt-1.5 h-2.5 w-1/2" />
    </div>
  )
}

/** The grid the card pages share (Collection, Browse), filled with shimmering tiles. */
export const CARD_GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(calc(150px*var(--card-scale,1)),1fr))] gap-x-4 gap-y-6 max-md:grid-cols-3 max-md:gap-x-2 max-md:gap-y-4'

/** A grid of tile shapes standing in for a page's cards while they load. */
export function CardGridSkeleton({
  label = 'Loading cards',
  count = 12,
  className = CARD_GRID
}: {
  label?: string
  count?: number
  className?: string
}): React.JSX.Element {
  return (
    <div role="status" aria-label={label} className={className}>
      {Array.from({ length: count }, (_, i) => (
        <TileSkeleton key={i} />
      ))}
    </div>
  )
}

/** A list of row shapes (sets, wishes, friends) while they load. */
export function RowsSkeleton({
  label = 'Loading',
  count = 6,
  className
}: {
  label?: string
  count?: number
  className?: string
}): React.JSX.Element {
  return (
    <div role="status" aria-label={label} className={cn('space-y-2', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          <Skeleton className="h-10 w-7 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}
