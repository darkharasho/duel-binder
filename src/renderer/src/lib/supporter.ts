import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** The supporter status query (api.supporter.status). */
export const SUPPORTER_KEY = ['supporter'] as const

/** Whether the signed-in account supports Duel Binder (for its own heart); false until known. */
export function useOwnSupporter(signedIn: boolean): boolean {
  const status = useQuery({
    queryKey: SUPPORTER_KEY,
    queryFn: () => api.supporter.status(),
    enabled: signedIn,
    retry: false
  })
  return !!status.data?.supporter
}
