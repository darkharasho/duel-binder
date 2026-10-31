import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { FriendsOverview } from '@shared/types'
import { api, queryKeys } from './api'
import { isWeb } from './platform'

const SIGNED_IN_KEY = 'friends.signedIn'

function readSignedIn(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === '1'
  } catch {
    return false
  }
}

function writeSignedIn(signedIn: boolean): void {
  try {
    localStorage.setItem(SIGNED_IN_KEY, signedIn ? '1' : '0')
  } catch {
    /* storage unavailable: the nav item just waits for the status */
  }
}

/**
 * `available`: web always; desktop when the account status has a user, or, until the first status
 * arrives, when the last one did (so the Friends nav item doesn't pop in). `confirmed`: the status
 * behind `available` has arrived. Subscribes to account.onChange.
 */
function useFriendsAccess(): { available: boolean; confirmed: boolean } {
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
  /** undefined until this hook has seen a status: the first one is the starting account, not a change. */
  const lastUser = useRef<number | string | null | undefined>(undefined)
  useEffect(() => {
    if (web || !status.isSuccess) return
    writeSignedIn(userId !== null)
    if (lastUser.current === undefined) {
      lastUser.current = userId
    } else if (lastUser.current !== userId) {
      lastUser.current = userId
      qc.removeQueries({ queryKey: queryKeys.friends })
    }
  }, [web, status.isSuccess, userId, qc])
  if (web) return { available: true, confirmed: true }
  if (!status.isSuccess) return { available: readSignedIn(), confirmed: false }
  return { available: userId !== null, confirmed: true }
}

/** Whether to offer friends: see useFriendsAccess. */
export function useFriendsAvailable(): boolean {
  return useFriendsAccess().available
}

/** Whether friends can be asked for: the status behind `available` has arrived. */
export function useFriendsReady(): boolean {
  const { available, confirmed } = useFriendsAccess()
  return available && confirmed
}

/** The overview query (key queryKeys.friends), enabled once available is confirmed, refetched every 60 s. */
export function useFriendsOverview(): UseQueryResult<FriendsOverview> {
  const { available, confirmed } = useFriendsAccess()
  return useQuery({
    queryKey: queryKeys.friends,
    queryFn: () => api.friends.overview(),
    enabled: available && confirmed,
    refetchInterval: 60_000,
    retry: false
  })
}

/** An error's message without Electron's "Error invoking remote method '…': Error: " IPC prefix. */
export function friendsErrorMessage(error: Error): string {
  return error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}
