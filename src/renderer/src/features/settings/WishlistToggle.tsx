import { useId } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { api, queryKeys } from '@/lib/api'
import { useFriendsReady } from '@/lib/friends'

/** Whether friends see this account's wishlist. The portal holds it, so it needs a sign-in. */
export function WishlistToggle({ className }: { className?: string }): React.JSX.Element | null {
  const id = useId()
  const qc = useQueryClient()
  const ready = useFriendsReady()
  const visible = useQuery({
    queryKey: queryKeys.wishlistVisible,
    queryFn: () => api.friends.wishlistVisible(),
    enabled: ready,
    retry: false
  })
  const set = useMutation({
    mutationFn: (on: boolean) => api.friends.setWishlistVisible(on),
    onMutate: (on) => qc.setQueryData(queryKeys.wishlistVisible, on),
    onError: () => {
      toast.error('Could not change that. Try again.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.wishlistVisible })
  })
  // Signed out, offline or on a portal without it, there's nothing to change.
  if (!ready || visible.data === undefined) return null
  return (
    <div className={className ?? 'flex items-start gap-3 text-sm'}>
      <Checkbox
        id={id}
        checked={visible.data}
        onCheckedChange={(c) => set.mutate(c === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="space-y-0.5">
        <span className="block">Show my wishlist to friends</span>
        <span className="block text-muted-foreground">
          Friends can see the cards you want, on your binder and on cards they own.
        </span>
      </label>
    </div>
  )
}
