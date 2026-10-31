import { useState } from 'react'
import { toast } from 'sonner'
import type { WishlistItem } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { PageHeader } from '@/components/PageHeader'
import { CardPanel } from '@/features/card/CardPanel'
import { api } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { unpricedIntl, useRequestPrices } from '@/lib/priceRequests'
import { useWishEdit, useWishOwners, useWishlist, wishlistCost } from '@/lib/wishlist'
import { WishlistRows } from './WishlistRows'

/** The card panel over a wishlist: the wanted type is the row it opens on. */
export function WishCardSheet({
  item,
  onClose
}: {
  item: WishlistItem
  onClose: () => void
}): React.JSX.Element {
  // A friend's item has the server's printing id, which means nothing in this catalog.
  const printingId = item.printingScan ? item.printing.id : null
  return (
    <CardSheet onClose={onClose}>
      <CardPanel
        cardId={item.card.id}
        printingId={printingId}
        seed={{
          name: item.card.name,
          type: item.card.type,
          imageId: item.imageId,
          price: item.unitPrice,
          defaultPrintingId: printingId
        }}
        onClose={onClose}
      />
    </CardSheet>
  )
}

const summary = (items: WishlistItem[]): string => {
  const { cost, unpriced } = wishlistCost(items)
  return [
    `${items.length} ${items.length === 1 ? 'card' : 'cards'}`,
    `${formatUsd(cost)} to get`,
    ...(unpriced > 0 ? [`${unpriced} without a price`] : [])
  ].join(' · ')
}

/** The cards this account wants, what getting them would cost, and which of them friends own. */
export function WishlistPage(): React.JSX.Element {
  const wishlist = useWishlist()
  const items = wishlist.data ?? []
  const owners = useWishOwners(items.map((w) => w.pkey))
  const [open, setOpen] = useState<WishlistItem | null>(null)
  useRequestPrices(
    unpricedIntl(
      items.map((w) => ({
        printingId: w.printing.id,
        language: w.printing.language,
        price: w.unitPrice
      }))
    )
  )
  const failed = (): void => {
    toast.error('Could not update your wishlist')
  }
  const setQuantity = useWishEdit<{ printingId: number; quantity: number | null }>(
    ({ printingId, quantity }) => api.wishlist.set(printingId, quantity),
    { onError: failed }
  )
  const remove = useWishEdit<number>((printingId) => api.wishlist.remove(printingId), {
    onError: failed
  })

  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>
        <h1 className="text-xl font-semibold">Wishlist</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          {items.length > 0 ? summary(items) : 'Cards you want'}
        </p>
      </PageHeader>
      {wishlist.isSuccess && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Open a card and press the heart next to the type you want.
        </p>
      ) : (
        <WishlistRows
          items={items}
          owners={owners}
          onOpen={setOpen}
          onQuantity={(w, quantity) => setQuantity.mutate({ printingId: w.printing.id, quantity })}
          onRemove={(w) => remove.mutate(w.printing.id)}
        />
      )}
      {open && <WishCardSheet item={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
