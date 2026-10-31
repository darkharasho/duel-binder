import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { FriendCardCopies } from '@shared/types'
import { api, queryKeys } from './api'
import { useFriendsReady } from './friends'
import { useGame } from './game'

/** A friend's binder rarely changes while you browse, and opening a card should stay instant. */
const STALE_MS = 5 * 60_000
const KEEP_MS = 30 * 60_000

/**
 * The friends who have a card, one request per card and game while it's fresh. Under the friends
 * key, so signing out, a friend change or another account drop it. An error (signed out, offline,
 * a portal without the call) leaves no data, and the caller shows nothing.
 */
export function useFriendsWithCard(cardId: number): UseQueryResult<FriendCardCopies[]> {
  const ready = useFriendsReady()
  const { def } = useGame()
  return useQuery({
    queryKey: queryKeys.friendsWithCard(def.id, cardId),
    queryFn: () => api.friends.forCard(cardId),
    enabled: ready,
    staleTime: STALE_MS,
    gcTime: KEEP_MS,
    retry: false
  })
}
