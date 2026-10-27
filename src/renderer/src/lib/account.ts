import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AccountStatus } from '@shared/types'
import { api, queryKeys } from './api'
import { isWeb } from './platform'

/**
 * The desktop account status, kept live through account.onChange. Undefined while the first status
 * is loading, and always on the web (which has no desktop account).
 */
export function useAccountStatus(): AccountStatus | undefined {
  return useAccountState().status
}

/** useAccountStatus plus whether the status query failed (so the gate can still offer sign-in). */
export function useAccountState(): { status: AccountStatus | undefined; failed: boolean } {
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
  return { status: web ? undefined : status.data, failed: !web && status.isError && !status.data }
}

/** Runs an account action and stores the status it resolves to (refetching if it fails). */
export function useApplyAccountStatus(): (p: Promise<AccountStatus>) => void {
  const qc = useQueryClient()
  return useCallback(
    (p) => {
      p.then((s) => qc.setQueryData(queryKeys.account, s)).catch(() =>
        qc.invalidateQueries({ queryKey: queryKeys.account })
      )
    },
    [qc]
  )
}
