import { useQueryClient } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { toast } from 'sonner'
import type { CardWish } from '@shared/types'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { useWishEdit } from '@/lib/wishlist'
import { cn } from '@/lib/utils'

/** A heart on a card type: wants the printing, or stops wanting it. Answers at once. */
export function WishToggle({
  cardId,
  printingId,
  wanted,
  label
}: {
  cardId: number
  printingId: number
  wanted: boolean
  label: string
}): React.JSX.Element {
  const qc = useQueryClient()
  const key = queryKeys.wishlistForCard(cardId)
  const toggle = useWishEdit<boolean>(
    (want) => (want ? api.wishlist.set(printingId, null) : api.wishlist.remove(printingId)),
    {
      onMutate: (want) => {
        const before = qc.getQueryData<CardWish[]>(key)
        const others = (before ?? []).filter((w) => w.printingId !== printingId)
        qc.setQueryData<CardWish[]>(
          key,
          want ? [...others, { printingId, quantity: null }] : others
        )
        return () => qc.setQueryData(key, before)
      },
      onError: (_e, _want, undo) => {
        undo?.()
        toast.error('Could not update your wishlist')
      }
    }
  )
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Want ${label}`}
      aria-pressed={wanted}
      onClick={() => toggle.mutate(!wanted)}
    >
      <Heart className={cn(wanted && 'fill-rose-400 text-rose-400')} />
    </Button>
  )
}
