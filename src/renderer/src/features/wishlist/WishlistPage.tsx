import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DollarSign, Heart, Users } from 'lucide-react'
import type { WishlistItem } from '@shared/types'
import type { NavigateFn } from '@/components/AppShell'
import { CardSheet } from '@/components/CardSheet'
import { EmptyHero, EmptySteps } from '@/components/EmptyHero'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { RowsSkeleton } from '@/components/ui/loading'
import { CardPanel } from '@/features/card/CardPanel'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { pageInGame, useGame } from '@/lib/game'
import { unpricedIntl, useRequestPrices } from '@/lib/priceRequests'
import {
  matchesWishSearch,
  useWishEdit,
  useWishOwners,
  useWishlist,
  wishlistCost
} from '@/lib/wishlist'
import { WishlistRows } from './WishlistRows'

/** The card panel over a wishlist: the wanted type is the row it opens on. */
export function WishCardSheet({
  item,
  onClose
}: {
  item: WishlistItem
  onClose: () => void
}): React.JSX.Element {
  // A friend's item has the server's printing id, which means nothing in this catalog; find its row
  // by what the printing is. On the web the catalog is the server's, and printingScan is true.
  const { printing } = item
  const detail = useQuery({
    queryKey: queryKeys.card(item.card.id),
    queryFn: () => api.cards.get(item.card.id),
    enabled: !item.printingScan
  })
  const printingId = item.printingScan
    ? printing.id
    : (detail.data?.printings.find(
        (p) =>
          p.setName === printing.setName &&
          p.setCode === printing.setCode &&
          p.setRarity === printing.setRarity &&
          p.language === printing.language
      )?.id ?? null)
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

const WISH_STEPS = [
  {
    icon: Heart,
    title: 'Heart a version',
    text: 'Open any card and press the heart next to the version you want.'
  },
  {
    icon: DollarSign,
    title: 'See what it costs',
    text: 'The list adds up what getting it all costs.'
  },
  { icon: Users, title: 'Spot it with a friend', text: 'Each card shows which friends own it.' }
] as const

function NoWishes({ onNavigate }: { onNavigate?: NavigateFn }): React.JSX.Element {
  const { def } = useGame()
  const browse = onNavigate && pageInGame('browse', def)
  const sets = onNavigate && pageInGame('sets', def)
  return (
    <EmptyHero
      id="no-wishes"
      title="Nothing on your wishlist yet"
      blurb="Keep track of the cards you're hunting, what they cost, and which friends could trade you one."
    >
      {(browse || sets) && (
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {browse && (
            <Button size="lg" onClick={() => onNavigate('browse')}>
              Browse cards
            </Button>
          )}
          {sets && (
            <Button size="lg" variant="outline" onClick={() => onNavigate('sets')}>
              Find a set&apos;s missing cards
            </Button>
          )}
        </div>
      )}
      <EmptySteps steps={WISH_STEPS} />
    </EmptyHero>
  )
}

/** The cards this account wants, what getting them would cost, and which of them friends own. */
export function WishlistPage({ onNavigate }: { onNavigate?: NavigateFn } = {}): React.JSX.Element {
  const wishlist = useWishlist()
  const items = wishlist.data ?? []
  const owners = useWishOwners(items.map((w) => w.pkey))
  const [open, setOpen] = useState<WishlistItem | null>(null)
  const [q, setQ] = useState('')
  const shown = useMemo(
    () => (wishlist.data ?? []).filter((w) => matchesWishSearch(w, q)),
    [wishlist.data, q]
  )
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
        {items.length > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">{summary(items)}</p>
        )}
        {items.length > 0 && (
          <SearchInput
            label="Search wishlist"
            placeholder="Search wishlist by name or set code"
            value={q}
            onChange={setQ}
          />
        )}
      </PageHeader>
      {wishlist.isSuccess && items.length === 0 ? (
        <NoWishes onNavigate={onNavigate} />
      ) : wishlist.isPending ? (
        <RowsSkeleton label="Loading your wishlist" />
      ) : items.length > 0 && shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cards match</p>
      ) : (
        <WishlistRows
          items={shown}
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
