import { useTileImage } from '@/lib/cardSize'
import type { EntryView } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { CardArt } from '@/components/CardArt'
import { FavouriteHeart } from '@/components/FavouriteHeart'
import { TiltCard } from '@/components/TiltCard'
import { scanFor } from '@/components/scanFor'
import { LanguageTag } from '@/components/LanguageTag'
import { TILE, TILE_BUTTON, TILE_HEART, TILE_NAME } from '@/components/tileLayout'
import type { Favourites } from '@/lib/favourites'
import { useChunkedList } from '@/lib/useChunkedList'
import { cn } from '@/lib/utils'
import { EntryValue, StaleBadge, displayTotal } from './EntryValue'

interface Props {
  entries: EntryView[]
  selectedId: number | null
  onSelect: (entry: EntryView) => void
  /** The owner's favourites, for a heart on each tile; left out on a friend's collection. */
  favourites?: Favourites
}

export function CollectionGrid({
  entries,
  selectedId,
  onSelect,
  favourites
}: Props): React.JSX.Element {
  const shown = useChunkedList(entries)
  const tileImage = useTileImage()
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(calc(150px*var(--card-scale,1)),1fr))] gap-x-4 gap-y-6 max-md:grid-cols-3 max-md:gap-x-2 max-md:gap-y-4"
      aria-label="Collection grid"
    >
      {shown.map((e) => (
        <li key={e.id} className={cn(TILE, 'lazy-item [--lazy-h:calc(310px*var(--card-scale,1))]')}>
          <button
            type="button"
            data-nav-key={e.id}
            onClick={() => onSelect(e)}
            aria-pressed={e.id === selectedId}
            className={cn(
              TILE_BUTTON,
              'group rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-white/[0.06]'
            )}
          >
            <TiltCard className="mb-2">
              <CardArt
                imageId={e.imageId}
                printingId={scanFor(e)}
                size={tileImage}
                alt={e.card.name}
                className="w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.45)]"
              />
              <Badge className="absolute right-1.5 top-1.5 font-mono shadow">×{e.quantity}</Badge>
            </TiltCard>
            <div className={cn('truncate text-[13px] font-semibold', favourites && TILE_NAME)}>
              {e.card.name}
            </div>
            <div className="mt-0.5 min-w-0 space-y-0.5">
              <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                <span className="truncate">
                  {e.printing.setCode} · {e.printing.setRarity}
                </span>
                <LanguageTag language={e.printing.language} />
              </div>
              <div className="font-mono text-xs">
                <EntryValue entry={e} amount={displayTotal(e)} />
              </div>
              <StaleBadge entry={e} />
            </div>
          </button>
          {favourites && (
            <FavouriteHeart
              cardId={e.card.id}
              name={e.card.name}
              favourites={favourites}
              className={TILE_HEART}
            />
          )}
        </li>
      ))}
    </ul>
  )
}
