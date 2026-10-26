import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { FriendsOverview } from '@shared/types'
import { api, queryKeys } from './api'
import { isWeb } from './platform'

/** Web: always. Desktop: when the account status has a user (subscribes to account.onChange). */
export function useFriendsAvailable(): boolean {
  const web = isWeb()
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: queryKeys.account,
    queryFn: () => api.account.status(),
    enabled: !web
  })
  useEffect(() => {
    if (web) return
    return api.account.onChange((s) => qc.setQueryData(queryKeys.account, s))
  }, [web, qc])
  // A different signed-in account (or none) must not see the previous account's friends.
  const userId = status.data?.user?.id ?? null
  const lastUser = useRef<number | string | null>(userId)
  useEffect(() => {
    if (web || !status.isSuccess) return
    if (lastUser.current !== userId) {
      lastUser.current = userId
      qc.removeQueries({ queryKey: queryKeys.friends })
    }
  }, [web, status.isSuccess, userId, qc])
  return web || userId !== null
}

/** The overview query (key queryKeys.friends), enabled only when available, refetched every 60 s. */
export function useFriendsOverview(): UseQueryResult<FriendsOverview> {
  const available = useFriendsAvailable()
  return useQuery({
    queryKey: queryKeys.friends,
    queryFn: () => api.friends.overview(),
    enabled: available,
    refetchInterval: 60_000,
    retry: false
  })
}

/** An error's message without Electron's "Error invoking remote method '…': Error: " IPC prefix. */
export function friendsErrorMessage(error: Error): string {
  return error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}
