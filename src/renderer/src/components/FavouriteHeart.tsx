import { Heart } from 'lucide-react'
import type { Favourites } from '@/lib/favourites'
import { cn } from '@/lib/utils'

/**
 * The heart at the right of a card tile's name row: favourites the card (every printing and copy
 * of it) or takes it off, at once, without opening the card. With a mouse it shows while the tile
 * (a `group/tile`) is hovered or focused, and always once on; on touch it always shows, with a
 * 44px target that doesn't grow the row. Never on a friend's cards: favourites are private.
 */
export function FavouriteHeart({
  cardId,
  name,
  favourites,
  className
}: {
  cardId: number
  name: string
  favourites: Favourites
  className?: string
}): React.JSX.Element {
  const on = favourites.isFavourite(cardId)
  return (
    <button
      type="button"
      aria-label={`${on ? 'Unfavourite' : 'Favourite'} ${name}`}
      data-on={on}
      onClick={(e) => {
        // A tile's row opens its card on a click or Enter; the heart only toggles.
        e.stopPropagation()
        favourites.toggle(cardId, !on)
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        'relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-opacity hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        "after:absolute after:-inset-1 after:content-[''] max-md:after:-inset-2.5 [@media(pointer:coarse)]:after:-inset-2.5",
        'opacity-0 focus-visible:opacity-100 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 data-[on=true]:opacity-100 max-md:opacity-100 [@media(pointer:coarse)]:opacity-100',
        className
      )}
    >
      <Heart className={cn('size-3.5', on && 'fill-rose-400 text-rose-400')} />
    </button>
  )
}
