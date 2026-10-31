import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Friend, WishlistItem } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { api, queryKeys } from '@/lib/api'
import { WishCardSheet } from './WishlistPage'
import { WishlistRows } from './WishlistRows'

/**
 * A friend's wishlist, read-only, as a tab of their binder. A hidden list reads as an
 * empty one, and so does a portal that can't answer.
 */
export function FriendWishlist({
  friend,
  header
}: {
  friend: Friend
  header: React.ReactNode
}): React.JSX.Element {
  const name = friend.displayName ?? friend.username
  const wishlist = useQuery({
    queryKey: queryKeys.friendWishlist(friend.id),
    queryFn: () => api.friends.wishlist(friend.id),
    retry: false
  })
  const [open, setOpen] = useState<WishlistItem | null>(null)
  const items = wishlist.data ?? []
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>{header}</PageHeader>
      {items.length > 0 ? (
        <WishlistRows items={items} onOpen={setOpen} />
      ) : (
        !wishlist.isPending && (
          <p className="text-sm text-muted-foreground">{name} has no wishlist to show.</p>
        )
      )}
      {open && <WishCardSheet item={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
