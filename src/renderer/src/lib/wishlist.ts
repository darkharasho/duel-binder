import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { MAX_PULL } from '@shared/cloud'
import type { CardWish, FriendWantsCard, WishlistItem, WishOwners } from '@shared/types'
import { api, invalidateAfterEdit, queryKeys } from './api'
import { useFriendsReady } from './friends'
import { useGame } from './game'

/** As with friends' copies: this changes rarely, and opening a card should stay instant. */
const STALE_MS = 5 * 60_000
const KEEP_MS = 30 * 60_000

/** Copies still to get: the target less those owned, or one until a copy of an untargeted want lands. */
export function stillWanted(w: Pick<WishlistItem, 'quantity' | 'owned'>): number {
  return Math.max(0, (w.quantity ?? 1) - w.owned)
}

/** What the rest of a list costs, and how many of its wants have no price. */
export function wishlistCost(items: WishlistItem[]): { cost: number; unpriced: number } {
  let cost = 0
  let unpriced = 0
  for (const w of items) {
    const left = stillWanted(w)
    if (left === 0) continue
    if (w.unitPrice === null) unpriced++
    else cost += w.unitPrice * left
  }
  return { cost, unpriced }
}

export function useWishlist(): UseQueryResult<WishlistItem[]> {
  return useQuery({ queryKey: queryKeys.wishlist, queryFn: () => api.wishlist.list() })
}

/** The wanted printings of a card; for the hearts on its rows. */
export function useCardWishes(cardId: number): UseQueryResult<CardWish[]> {
  return useQuery({
    queryKey: queryKeys.wishlistForCard(cardId),
    queryFn: () => api.wishlist.forCard(cardId)
  })
}

/** Writes to the wishlist, then refreshes whatever shows it. */
export function useWishEdit<T>(
  write: (input: T) => Promise<void>,
  opts: Pick<
    Parameters<typeof useMutation<void, Error, T, () => void>>[0],
    'onMutate' | 'onError'
  > = {}
): UseMutationResult<void, Error, T, () => void> {
  const qc = useQueryClient()
  return useMutation<void, Error, T, () => void>({
    mutationFn: write,
    ...opts,
    onSettled: () => invalidateAfterEdit(qc, (k) => k[0] !== queryKeys.wishlist[0])
  })
}

/**
 * The friends who want a card, one request per card and game while it's fresh; asked only when
 * `enabled`. Under the friends key, so signing out or a friend change drop it. An error (signed
 * out, offline, a portal without the call) leaves no data, and the caller shows nothing.
 */
export function useFriendsWanting(
  cardId: number,
  enabled: boolean
): UseQueryResult<FriendWantsCard[]> {
  const ready = useFriendsReady()
  const { def } = useGame()
  return useQuery({
    queryKey: queryKeys.friendsWanting(def.id, cardId),
    queryFn: () => api.friends.wanting(cardId),
    enabled: ready && enabled,
    staleTime: STALE_MS,
    gcTime: KEEP_MS,
    retry: false
  })
}

/** The friends who own each of these printings, in one request; nothing when it can't be asked. */
export function useWishOwners(pkeys: string[]): Map<string, WishOwners['friends']> {
  const ready = useFriendsReady()
  const { def } = useGame()
  // The portal answers MAX_PULL at most; past that a want just shows no friends.
  const sorted = [...pkeys].sort().slice(0, MAX_PULL)
  const { data } = useQuery({
    queryKey: queryKeys.friendsOwning(def.id, sorted),
    queryFn: () => api.friends.owning(sorted),
    enabled: ready && sorted.length > 0,
    staleTime: STALE_MS,
    gcTime: KEEP_MS,
    retry: false
  })
  return new Map((data ?? []).map((o) => [o.pkey, o.friends]))
}
