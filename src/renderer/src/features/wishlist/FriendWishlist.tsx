import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import type { Friend, WishlistItem } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { WishCardSheet } from './WishlistPage'
import { WishlistRows } from './WishlistRows'

/**
 * A friend's wishlist, read-only, as the other tab of their binder. A hidden list reads as an
 * empty one, and so does a portal that can't answer.
 */
export function FriendWishlist({
  friend,
  tabs,
  onBackToMine,
  onBackToFriends
}: {
  friend: Friend
  tabs: React.ReactNode
  onBackToMine?: () => void
  onBackToFriends?: () => void
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
      <PageHeader>
        <h1 className="text-xl font-semibold">{name}&apos;s wishlist</h1>
        <div className="flex items-center gap-3 max-md:flex-wrap max-md:gap-2">
          {onBackToFriends && (
            <Button variant="ghost" size="sm" onClick={onBackToFriends}>
              <ArrowLeft />
              All friends
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onBackToMine}>
            Back to mine
          </Button>
        </div>
        {tabs}
      </PageHeader>
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
