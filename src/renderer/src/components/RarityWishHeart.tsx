import { useState } from 'react'
import { Heart } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useWishEdit } from '@/lib/wishlist'
import { cn } from '@/lib/utils'
import { HEART_BUTTON } from './tileLayout'

/**
 * A rarity tile's heart: wants that rarity's printing (an overframe apart from the plain card),
 * or stops wanting any of the rarity's printings. Only that rarity's tile fills; the card's other
 * rarities stay as they are. Answers at once, before the wishlist reloads.
 */
export function RarityWishHeart({
  printingId,
  printingIds,
  wanted,
  label,
  className
}: {
  /** The printing a new want goes on: the rarity's default code in the set. */
  printingId: number
  /** Every printing of the rarity in the set, each taken off when the heart is. */
  printingIds: number[]
  /** Whether any of printingIds is on the wishlist. */
  wanted: boolean
  label: string
  className?: string
}): React.JSX.Element {
  // Shown until the wishlist has reloaded with the change (useWishEdit waits for it), or it fails.
  const [shown, setShown] = useState<boolean | null>(null)
  const toggle = useWishEdit<boolean>(
    async (want) => {
      if (want) await api.wishlist.set(printingId, null)
      else for (const id of printingIds) await api.wishlist.remove(id)
    },
    {
      onMutate: (want) => {
        setShown(want)
        return () => setShown(null)
      },
      onError: (_e, _want, undo) => {
        undo?.()
        toast.error('Could not update your wishlist')
      }
    }
  )
  const on = shown ?? wanted
  return (
    <button
      type="button"
      aria-label={`${on ? 'Stop wanting' : 'Want'} ${label}`}
      aria-pressed={on}
      data-on={on}
      onClick={(e) => {
        // A tile opens its card on a click or Enter; the heart only toggles.
        e.stopPropagation()
        toggle.mutate(!on, { onSettled: () => setShown(null) })
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(HEART_BUTTON, className)}
    >
      <Heart className={cn('size-3.5', on && 'fill-rose-400 text-rose-400')} />
    </button>
  )
}
